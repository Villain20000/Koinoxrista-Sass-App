import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  REFERRAL_REFERRED_MONTHS,
  REFERRAL_REFERRER_MONTHS,
  normalizeReferralCode,
  type ReferralCreditDto,
  type ReferralInfoDto,
  type ReferralReason,
} from '@org/shared/lib/referrals';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';

/** Unambiguous alphabet (no O/0/I/1) for the random part of `BLD-XXXXXX`. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RANDOM_LENGTH = 6;
const CODE_GENERATION_ATTEMPTS = 8;

export function generateReferralCode(): string {
  const bytes = randomBytes(CODE_RANDOM_LENGTH);
  let suffix = '';
  for (let i = 0; i < CODE_RANDOM_LENGTH; i += 1) {
    suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `BLD-${suffix}`;
}

export interface ReferralRewardResult {
  granted: boolean;
  /** False when the code was unknown, self-referential or already redeemed. */
  reason?: 'INVALID_CODE' | 'SELF_REFERRAL' | 'ALREADY_REFERRED';
}

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Idempotent code fetch-or-create for a building. Concurrent creations race
   * on the unique index and are retried with a fresh suffix.
   */
  async ensureCode(buildingId: string): Promise<string> {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true, referralCode: true },
    });
    if (!building) throw new NotFoundException('Building not found');
    if (building.referralCode) return building.referralCode;

    for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const code = generateReferralCode();
      try {
        await this.prisma.building.update({
          where: { id: buildingId },
          data: { referralCode: code },
        });
        this.audit.record({
          buildingId,
          action: 'referral.code.created',
          entity: 'Building',
          entityId: buildingId,
          metadata: { code },
        });
        return code;
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }
    throw new BadRequestException('Could not allocate a referral code');
  }

  /** Fresh code, discarding the previous one (old links stop working). */
  async rotateCode(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<{ code: string }> {
    assertSameBuilding(user, buildingId);
    await this.ensureCode(buildingId);
    for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const code = generateReferralCode();
      try {
        await this.prisma.building.update({
          where: { id: buildingId },
          data: { referralCode: code },
        });
        this.audit.record({
          buildingId,
          actorId: user.id,
          actorRole: user.role,
          action: 'referral.code.rotated',
          entity: 'Building',
          entityId: buildingId,
          metadata: { code },
        });
        return { code };
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }
    throw new BadRequestException('Could not allocate a referral code');
  }

  async info(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<ReferralInfoDto> {
    assertSameBuilding(user, buildingId);
    const code = await this.ensureCode(buildingId);
    const credits = await this.listCredits(buildingId);
    return { code, referralUrlBase: this.referralUrlBase(), credits };
  }

  async listCredits(buildingId: string): Promise<ReferralCreditDto[]> {
    const rows = await this.prisma.referralCredit.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toCreditDto(row));
  }

  /**
   * Grants the reward pair for a completed referral:
   *  - REFERRED side: REFERRAL_REFERRED_MONTHS single-month credits to the
   *    newly activated building (its free trial months, spent as platform-fee
   *    discounts by the recurring self-billing run),
   *  - REFERRER side: one month credit to the code owner.
   *
   * Idempotent per referred building (a second call — double registration,
   * re-activation — is a no-op), rejects unknown codes and self-referrals.
   */
  async grantReferralRewards(
    referredBuildingId: string,
    rawCode: string | null | undefined,
  ): Promise<ReferralRewardResult> {
    const code = normalizeReferralCode(rawCode);
    if (!code) {
      return { granted: false, reason: 'INVALID_CODE' };
    }

    const owner = await this.prisma.building.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!owner || owner.id === referredBuildingId) {
      if (!owner) this.logger.warn(`Unknown referral code used: ${code}`);
      return {
        granted: false,
        reason: owner ? 'SELF_REFERRAL' : 'INVALID_CODE',
      };
    }

    // Double-registration guard: one REFERRED reward per building, ever.
    const existing = await this.prisma.referralCredit.findFirst({
      where: { buildingId: referredBuildingId, reason: 'REFERRED' },
      select: { id: true },
    });
    if (existing) {
      return { granted: false, reason: 'ALREADY_REFERRED' };
    }

    const rows = await this.prisma.$transaction([
      ...this.rewardRows(referredBuildingId, owner.id, code, 'REFERRED', REFERRAL_REFERRED_MONTHS).map(
        (data) => this.prisma.referralCredit.create({ data }),
      ),
      ...this.rewardRows(owner.id, referredBuildingId, code, 'REFERRER', REFERRAL_REFERRER_MONTHS).map(
        (data) => this.prisma.referralCredit.create({ data }),
      ),
    ]);

    this.audit.record({
      buildingId: referredBuildingId,
      action: 'referral.reward.granted',
      entity: 'ReferralCredit',
      entityId: rows
        .filter((r) => r.reason === 'REFERRED')
        .map((r) => r.id)
        .join(','),
      metadata: { code, months: REFERRAL_REFERRED_MONTHS },
    });
    this.audit.record({
      buildingId: owner.id,
      action: 'referral.reward.granted',
      entity: 'ReferralCredit',
      entityId: rows
        .filter((r) => r.reason === 'REFERRER')
        .map((r) => r.id)
        .join(','),
      metadata: { code, months: REFERRAL_REFERRER_MONTHS },
    });

    return { granted: true };
  }

  private rewardRows(
    buildingId: string,
    sourceBuildingId: string,
    code: string,
    reason: ReferralReason,
    months: number,
  ): Array<{ reason: string; code: string; buildingId: string; sourceBuildingId: string }> {
    // One row per month so redemption consumes whole atomic units.
    return Array.from({ length: months }, () => ({
      reason,
      code,
      buildingId,
      sourceBuildingId,
    }));
  }

  private referralUrlBase(): string {
    const base = process.env.WEB_APP_URL ?? 'http://localhost:4200';
    return `${base.replace(/\/+$/, '')}/register`;
  }

  private toCreditDto(row: {
    id: string;
    buildingId: string;
    sourceBuildingId: string | null;
    code: string;
    months: number;
    reason: string;
    usedAt: Date | null;
    usedPeriod: string | null;
    createdAt: Date;
  }): ReferralCreditDto {
    return {
      id: row.id,
      buildingId: row.buildingId,
      sourceBuildingId: row.sourceBuildingId,
      code: row.code,
      months: row.months,
      reason: row.reason as ReferralReason,
      usedAt: row.usedAt?.toISOString() ?? null,
      usedPeriod: row.usedPeriod ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
