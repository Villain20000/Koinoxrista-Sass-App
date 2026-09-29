import {
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { Subscription as SubscriptionRecord } from '@prisma/client';

import {
  FEATURES_BY_TIER,
  TIER_PRICES_CENTS,
  TRIAL_DAYS,
  type BillingCycle,
  type ChangeTierDto,
  type FeatureFlags,
  type SubscriptionDto,
  type SubscriptionStatus,
  type SubscriptionTier,
} from '@org/shared';

import { assertMinimumUnits, priceFor } from './pricing';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PlatformInvoiceService } from '../self-billing/platform-invoice.service';
import { ReferralsService } from '../referrals/referrals.service';
import { normalizeReferralCode } from '@org/shared/lib/referrals';

/**
 * Deliberate policy choice: an unpaid trial that has expired is surfaced as
 * PAST_DUE (the stored TRIALING row stays untouched until an admin acts).
 */
export function deriveStatus(record: {
  status: SubscriptionStatus;
  trialEndsAt: Date | string | null;
}): SubscriptionStatus {
  if (
    record.status === 'TRIALING' &&
    record.trialEndsAt &&
    new Date(record.trialEndsAt).getTime() < Date.now()
  ) {
    return 'PAST_DUE';
  }
  return record.status;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.setMonth(date.getMonth() + months));
}

function addYears(date: Date, years: number): Date {
  return addMonths(date, years * 12);
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional so standalone instantiation (specs, tooling) keeps working.
    @Optional()
    @Inject(forwardRef(() => PlatformInvoiceService))
    private readonly platformInvoices?: PlatformInvoiceService,
    // Optional for the same reason; grants referral rewards post-activation.
    @Optional()
    private readonly referrals?: ReferralsService,
  ) {}

  async getOrCreate(buildingId: string): Promise<SubscriptionDto> {
    return this.toDto(await this.getOrCreateRecord(buildingId));
  }

  async changeTier(
    buildingId: string,
    dto: ChangeTierDto,
    actor?: Pick<AuthenticatedUser, 'id' | 'role'> | null,
  ): Promise<SubscriptionDto> {
    const units = await this.prisma.unit.count({ where: { buildingId } });
    assertMinimumUnits(units);
    const record = await this.getOrCreateRecord(buildingId);
    const updated = await this.prisma.subscription.update({
      where: { id: record.id },
      data: {
        tier: dto.tier,
        billingCycle: dto.billingCycle,
        pricePerUnitCents: TIER_PRICES_CENTS[dto.tier],
        units,
        ...(record.status === 'CANCELLED' ? { status: 'ACTIVE' } : {}),
      },
    });
    // Self-billing of a prorated delta is best-effort and must never block
    // tier management (no-op for downgrades / periods not yet opened).
    try {
      await this.platformInvoices?.issueForTierChange(
        record,
        updated,
        actor ?? null,
      );
    } catch {
      // ignored deliberately
    }
    return this.toDto(updated);
  }

  /**
   * Activates the current period. `referralCode` is the code captured at
   * signup (`/register?ref=…`); on the FIRST activation of a building the
   * referral reward pair (3 months REFERRED + 1 month REFERRER) is granted
   * fire-and-forget — it must never fail or delay activation.
   */
  async activatePeriod(
    buildingId: string,
    referralCode?: string,
  ): Promise<SubscriptionDto> {
    const record = await this.getOrCreateRecord(buildingId);
    const firstActivation = record.status !== 'ACTIVE';
    const now = new Date();
    const end =
      record.billingCycle === 'MONTHLY'
        ? addMonths(new Date(now), 1)
        : addYears(new Date(now), 1);
    const updated = await this.prisma.subscription.update({
      where: { id: record.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: end,
        cancelAt: null,
      },
    });
    const code = normalizeReferralCode(referralCode);
    if (firstActivation && updated.status === 'ACTIVE' && code) {
      void this.referrals
        ?.grantReferralRewards(buildingId, code)
        .catch((error) =>
          this.logger.warn(
            `Referral reward grant failed for ${buildingId}: ${String(error)}`,
          ),
        );
    }
    return this.toDto(updated);
  }

  async cancel(buildingId: string): Promise<SubscriptionDto> {
    const record = await this.getOrCreateRecord(buildingId);
    const cancelAt = record.currentPeriodEnd ?? new Date();
    const updated = await this.prisma.subscription.update({
      where: { id: record.id },
      data: { status: 'CANCELLED', cancelAt },
    });
    return this.toDto(updated);
  }

  async features(buildingId: string): Promise<FeatureFlags> {
    const tier = (await this.getOrCreateRecord(buildingId)).tier;
    return FEATURES_BY_TIER[tier];
  }

  private async getOrCreateRecord(
    buildingId: string,
  ): Promise<SubscriptionRecord> {
    const existing = await this.prisma.subscription.findUnique({
      where: { buildingId },
    });
    if (existing) return existing;

    try {
      const units = await this.prisma.unit.count({ where: { buildingId } });
      return await this.prisma.subscription.create({
        data: {
          buildingId,
          tier: 'BASIC',
          status: 'TRIALING',
          billingCycle: 'MONTHLY',
          units,
          pricePerUnitCents: TIER_PRICES_CENTS.BASIC,
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        return this.prisma.subscription.findUniqueOrThrow({
          where: { buildingId },
        });
      }
      throw error;
    }
  }

  private toDto(record: SubscriptionRecord): SubscriptionDto {
    return {
      id: record.id,
      buildingId: record.buildingId,
      tier: record.tier as SubscriptionTier,
      status: record.status as SubscriptionStatus,
      derivedStatus: deriveStatus(record),
      billingCycle: record.billingCycle as BillingCycle,
      units: record.units,
      pricePerUnitCents: record.pricePerUnitCents,
      nextChargeCents: priceFor(
        record.tier as SubscriptionTier,
        record.billingCycle as BillingCycle,
        record.units,
      ),
      trialEndsAt: record.trialEndsAt?.toISOString() ?? null,
      currentPeriodStart: record.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: record.currentPeriodEnd?.toISOString() ?? null,
      cancelAt: record.cancelAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
