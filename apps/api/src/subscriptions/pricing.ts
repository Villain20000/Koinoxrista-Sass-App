import { BadRequestException } from '@nestjs/common';

import {
  MIN_UNITS,
  TIER_PRICES_CENTS,
  periodTotalCents,
  type BillingCycle,
  type SubscriptionTier,
} from '@org/shared';

/** Total cents charged for one billing period of `unitCount` units (pure). */
export function priceFor(
  tier: SubscriptionTier,
  cycle: BillingCycle,
  unitCount: number,
): number {
  return periodTotalCents(tier, cycle, unitCount);
}

/** Enforces the PLAN.md §6 minimum building size for paid subscriptions. */
export function assertMinimumUnits(unitCount: number): void {
  if (!Number.isInteger(unitCount) || unitCount < MIN_UNITS) {
    throw new BadRequestException(
      `Subscription requires at least ${MIN_UNITS} units`,
    );
  }
}

/**
 * Integer-cents delta owed when switching tiers `daysUsedInPeriod` days into a
 * `totalDays`-long monthly period, priced on per-unit MONTHLY rates (pure).
 * Downgrades yield 0 (credit notes are out of scope).
 */
export function prorateDelta(
  fromTier: SubscriptionTier,
  toTier: SubscriptionTier,
  daysUsedInPeriod: number,
  totalDays: number,
  unitCount: number,
): number {
  if (!Number.isInteger(totalDays) || totalDays <= 0) return 0;
  const remainingDays = Math.min(
    Math.max(totalDays - Math.max(daysUsedInPeriod, 0), 0),
    totalDays,
  );
  const delta =
    ((TIER_PRICES_CENTS[toTier] - TIER_PRICES_CENTS[fromTier]) *
      unitCount *
      remainingDays) /
    totalDays;
  return Math.max(0, Math.round(delta));
}
