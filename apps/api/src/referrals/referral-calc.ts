import {
  periodTotalCents,
  type SubscriptionTier,
} from '@org/shared';

/** Cents one full month of platform fee is worth for `tier`/`unitCount` (pure). */
export function monthlyFeeCents(tier: SubscriptionTier, units: number): number {
  return periodTotalCents(tier, 'MONTHLY', units);
}

/**
 * Gross cents `months` referral credits knock off a recurring invoice before
 * capping against the actual charge (pure). Reuses the subscriptions pricing
 * helpers so credits always track the real MONTHLY fee.
 */
export function monthsToCentsDiscount(
  months: number,
  tier: SubscriptionTier,
  units: number,
): number {
  if (!Number.isFinite(months) || months <= 0) return 0;
  return monthlyFeeCents(tier, units) * Math.floor(months);
}

export interface CreditRedemptionPlan {
  /** Whole credit months consumed by this invoice. */
  monthsConsumed: number;
  /** Cents to subtract from the charge (always ≤ charge). */
  discountCents: number;
}

/**
 * Decides how many whole credit-months an invoice of `chargeCents` consumes
 * (pure). Policy: only WHOLE months are consumed — a charge smaller than one
 * monthly fee redeems nothing rather than partially burning a credit, and the
 * discount is the value of the consumed months capped at the charge.
 */
export function planCreditRedemption(
  chargeCents: number,
  availableMonths: number,
  tier: SubscriptionTier,
  units: number,
): CreditRedemptionPlan {
  const monthly = monthlyFeeCents(tier, units);
  if (
    !Number.isFinite(chargeCents) ||
    !Number.isFinite(availableMonths) ||
    chargeCents <= 0 ||
    availableMonths <= 0 ||
    monthly <= 0
  ) {
    return { monthsConsumed: 0, discountCents: 0 };
  }
  const affordable = Math.floor(chargeCents / monthly);
  const monthsConsumed = Math.min(affordable, Math.floor(availableMonths));
  const discountCents = Math.min(monthsConsumed * monthly, Math.floor(chargeCents));
  return { monthsConsumed, discountCents };
}
