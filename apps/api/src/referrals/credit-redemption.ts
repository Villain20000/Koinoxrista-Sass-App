import type { SubscriptionTier } from '@org/shared';

import { planCreditRedemption } from './referral-calc';

/**
 * Runtime credit redemption used by the self-billing recurring issuance.
 * Deliberately a free function (no Nest DI) so `PlatformInvoiceService` can
 * call it as a surgical, dependency-free hook that can never block issuance:
 * callers wrap it in try/catch and treat failures as "no discount".
 */

/** Structural row shape of `ReferralCredit` (survives prisma generate). */
export interface ReferralCreditRow {
  id: string;
  buildingId: string;
  code: string;
  months: number;
  reason: string;
  usedAt: Date | null;
  usedPeriod: string | null;
  createdAt: Date;
}

interface ReferralCreditDelegate {
  findMany(args: {
    where: { buildingId: string; usedAt: null };
    orderBy: { createdAt: 'asc' };
  }): Promise<ReferralCreditRow[]>;
  updateMany(args: {
    where: { id: { in: string[] }; usedAt: null };
    data: { usedAt: Date; usedPeriod: string };
  }): Promise<{ count: number }>;
}

export interface RedemptionPrisma {
  referralCredit: ReferralCreditDelegate;
}

export interface CreditAuditSink {
  record(entry: {
    buildingId?: string | null;
    actorId?: string | null;
    actorRole?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): void;
}

export interface RedeemCreditsInput {
  buildingId: string;
  period: string;
  tier: SubscriptionTier;
  units: number;
  chargeCents: number;
}

/**
 * Oldest-first consumption of unused ReferralCredit months against a
 * recurring charge. Returns the discount cents to apply (0 when no credits or
 * nothing affordable); consumed rows get `usedAt`/`usedPeriod` stamped.
 */
export async function redeemReferralCredits(
  prisma: RedemptionPrisma,
  audit: CreditAuditSink,
  input: RedeemCreditsInput,
): Promise<number> {
  const available = await prisma.referralCredit.findMany({
    where: { buildingId: input.buildingId, usedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const plan = planCreditRedemption(
    input.chargeCents,
    available.length,
    input.tier,
    input.units,
  );
  if (plan.monthsConsumed <= 0 || plan.discountCents <= 0) return 0;

  const consumedIds = available.slice(0, plan.monthsConsumed).map((c) => c.id);
  const result = await prisma.referralCredit.updateMany({
    where: { id: { in: consumedIds }, usedAt: null },
    data: { usedAt: new Date(), usedPeriod: input.period },
  });
  if (result.count === 0) return 0;

  audit.record({
    buildingId: input.buildingId,
    action: 'referral.credit.redeemed',
    entity: 'ReferralCredit',
    entityId: consumedIds.join(','),
    metadata: {
      period: input.period,
      monthsConsumed: Math.min(result.count, plan.monthsConsumed),
      discountCents: plan.discountCents,
    },
  });
  return plan.discountCents;
}
