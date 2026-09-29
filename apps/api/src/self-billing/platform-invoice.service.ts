import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { formatPeriod, isValidPeriod, type SubscriptionTier } from '@org/shared';
import type {
  PlatformInvoiceDto,
  PlatformInvoiceStatus,
  RunPeriodResponseDto,
} from '@org/shared/lib/self-billing';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { priceFor, prorateDelta } from '../subscriptions/pricing';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  redeemReferralCredits,
  type RedemptionPrisma,
} from '../referrals/credit-redemption';
import type { SubscriptionDto } from '@org/shared';

/** Structural row shape of `PlatformInvoice` (survives prisma generate). */
export interface PlatformInvoiceRow {
  id: string;
  buildingId: string;
  subscriptionId: string | null;
  number: string;
  period: string;
  tier: string;
  units: number;
  amountCents: number;
  status: string;
  issuedAt: Date;
  paidAt: Date | null;
}

interface InvoiceDelegate {
  findUnique(args: {
    where: {
      id?: string;
      subscriptionId_period?: { subscriptionId: string; period: string };
    };
  }): Promise<PlatformInvoiceRow | null>;
  findFirst(args: {
    where: { id?: string; buildingId?: string };
  }): Promise<PlatformInvoiceRow | null>;
  findMany(args: {
    where: { buildingId: string };
    orderBy: { issuedAt: 'desc' };
  }): Promise<PlatformInvoiceRow[]>;
  count(args: {
    where: {
      subscriptionId: string;
      period?: { startsWith: string };
    };
  }): Promise<number>;
  create(args: {
    data: Omit<PlatformInvoiceRow, 'id' | 'issuedAt' | 'paidAt'> & {
      paidAt?: Date | null;
    };
  }): Promise<PlatformInvoiceRow>;
}

type InvoiceTx = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'> & {
  platformInvoice: InvoiceDelegate;
};

/** Subset of a subscription record needed to price a tier-change delta. */
export interface TierChangeSnapshot {
  id: string;
  buildingId: string;
  tier: string;
  units: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Per-year `pg_advisory_xact_lock` key base for document numbering. */
const NUMBER_LOCK_BASE = 736_000_000;

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class PlatformInvoiceService {
  private readonly logger = new Logger(PlatformInvoiceService.name);
  private readonly invoices: InvoiceDelegate;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
    private readonly audit: AuditService,
  ) {
    this.invoices = (
      prisma as unknown as { platformInvoice: InvoiceDelegate }
    ).platformInvoice;
  }

  async list(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<PlatformInvoiceDto[]> {
    assertSameBuilding(user, buildingId);
    const rows = await this.invoices.findMany({
      where: { buildingId },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async getOne(
    buildingId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<PlatformInvoiceDto> {
    assertSameBuilding(user, buildingId);
    const row = await this.invoices.findFirst({ where: { id, buildingId } });
    if (!row) {
      throw new NotFoundException('Platform invoice not found');
    }
    return this.toDto(row);
  }

  /**
   * Idempotent issuance of the recurring fee for `period` (YYYY-MM). A second
   * run for the same subscription+period returns the existing invoice with
   * `created: false` and writes nothing.
   */
  async runPeriod(
    buildingId: string,
    period: string,
    user: AuthenticatedUser,
  ): Promise<RunPeriodResponseDto> {
    assertSameBuilding(user, buildingId);
    if (!isValidPeriod(period)) {
      throw new BadRequestException('period must match YYYY-MM');
    }

    const sub = await this.subscriptionsService.getOrCreate(buildingId);
    const existing = await this.invoices.findUnique({
      where: {
        subscriptionId_period: { subscriptionId: sub.id, period },
      },
    });
    if (existing) {
      return { created: false, invoice: this.toDto(existing) };
    }

    let amountCents = this.recurringAmountCents(sub, period);
    // Referral credits act as discounts on the recurring fee. Best-effort by
    // design: any credit failure must never block invoice issuance.
    try {
      const discountCents = await redeemReferralCredits(
        this.prisma as unknown as RedemptionPrisma,
        this.audit,
        {
          buildingId,
          period,
          tier: sub.tier,
          units: sub.units,
          chargeCents: amountCents,
        },
      );
      amountCents = Math.max(0, amountCents - discountCents);
    } catch (error) {
      this.logger.error(
        `Referral credit redemption failed for ${buildingId}/${period}: ${String(error)}`,
      );
    }
    const invoice = await this.issue(
      {
        buildingId,
        subscriptionId: sub.id,
        period,
        tier: sub.tier,
        units: sub.units,
        amountCents,
      },
      'PERIOD_RUN',
      user,
    );
    return { created: true, invoice };
  }

  /**
   * Issues the prorated delta after a tier change. Best-effort from the
   * caller's perspective: returns null when there is no open period or
   * nothing to charge (downgrades / equal tiers).
   */
  async issueForTierChange(
    before: TierChangeSnapshot,
    after: TierChangeSnapshot,
    actor?: Pick<AuthenticatedUser, 'id' | 'role'> | null,
  ): Promise<PlatformInvoiceDto | null> {
    const start = before.currentPeriodStart;
    const end = before.currentPeriodEnd;
    if (!start || !end) return null;

    const totalDays = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (totalDays <= 0) return null;

    const now = Date.now();
    const daysUsedInPeriod = Math.min(
      Math.max(Math.floor((now - start.getTime()) / DAY_MS), 0),
      totalDays,
    );

    const deltaCents = prorateDelta(
      before.tier as SubscriptionTier,
      after.tier as SubscriptionTier,
      daysUsedInPeriod,
      totalDays,
      after.units,
    );
    if (deltaCents <= 0) return null;

    const month = formatPeriod(start);
    const adjustments = await this.invoices.count({
      where: {
        subscriptionId: after.id,
        period: { startsWith: `${month}-ADJ` },
      },
    });

    const invoice = await this.issue(
      {
        buildingId: after.buildingId,
        subscriptionId: after.id,
        period: `${month}-ADJ-${adjustments + 1}`,
        tier: after.tier,
        units: after.units,
        amountCents: deltaCents,
      },
      'TIER_CHANGE',
      actor ?? null,
    );
    return invoice;
  }

  /**
   * Policy: TRIALING/CANCELLED subscriptions are never charged (zero-amount,
   * auto-PAID). ANNUAL cycles bill the discounted annual total only in their
   * anniversary month (the one holding currentPeriodStart); MONTHLY bills the
   * flat monthly total every period.
   */
  private recurringAmountCents(sub: SubscriptionDto, period: string): number {
    if (sub.status === 'TRIALING' || sub.status === 'CANCELLED') return 0;
    if (sub.billingCycle === 'ANNUAL') {
      const anniversaryMonth = sub.currentPeriodStart
        ? formatPeriod(new Date(sub.currentPeriodStart))
        : null;
      return anniversaryMonth === period
        ? priceFor(sub.tier, 'ANNUAL', sub.units)
        : 0;
    }
    return priceFor(sub.tier, 'MONTHLY', sub.units);
  }

  /**
   * Race-safe issuance: an interactive transaction takes a per-year advisory
   * lock, derives `SI-<year>-<seq>` from the current max number, and relies on
   * both the number unique key and @@unique([subscriptionId, period]) — with a
   * single retry-once on unique violation as belt-and-braces.
   */
  private async issue(
    input: {
      buildingId: string;
      subscriptionId: string;
      period: string;
      tier: string;
      units: number;
      amountCents: number;
    },
    trigger: 'PERIOD_RUN' | 'TIER_CHANGE',
    actor: Pick<AuthenticatedUser, 'id' | 'role'> | null,
  ): Promise<PlatformInvoiceDto> {
    const attempt = (): Promise<PlatformInvoiceRow> =>
      this.prisma.$transaction(async (client) => {
        const tx = client as unknown as InvoiceTx;
        const year = Number(input.period.slice(0, 4));
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${NUMBER_LOCK_BASE + year})`;

        const rows = await tx.$queryRaw<{ number: string }[]>`
          SELECT "number" FROM "PlatformInvoice"
          WHERE "number" LIKE ${`SI-${year}-%`}
          ORDER BY "number" DESC
          LIMIT 1`;
        const lastSeq = rows[0]
          ? parseInt(rows[0].number.slice(`SI-${year}-`.length), 10)
          : 0;
        const number = `SI-${year}-${String(lastSeq + 1).padStart(4, '0')}`;

        const zeroAmount = input.amountCents <= 0;
        return tx.platformInvoice.create({
          data: {
            ...input,
            number,
            status: zeroAmount ? 'PAID' : 'ISSUED',
            ...(zeroAmount ? { paidAt: new Date() } : {}),
          },
        });
      });

    let row: PlatformInvoiceRow;
    try {
      row = await attempt();
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      // Lost a numbering race: recompute max sequence and issue once more.
      row = await attempt();
    }

    this.audit.record({
      buildingId: input.buildingId,
      actorId: actor?.id ?? null,
      actorRole: actor?.role ?? null,
      action: 'platform_invoice.issued',
      entity: 'PlatformInvoice',
      entityId: row.id,
      metadata: {
        trigger,
        number: row.number,
        period: row.period,
        tier: row.tier,
        units: row.units,
        amountCents: row.amountCents,
        status: row.status,
      },
    });

    return this.toDto(row);
  }

  private toDto(row: PlatformInvoiceRow): PlatformInvoiceDto {
    return {
      id: row.id,
      buildingId: row.buildingId,
      subscriptionId: row.subscriptionId,
      number: row.number,
      period: row.period,
      tier: row.tier as SubscriptionTier,
      units: row.units,
      amountCents: row.amountCents,
      status: row.status as PlatformInvoiceStatus,
      issuedAt: row.issuedAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
    };
  }
}
