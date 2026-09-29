export type SubscriptionTier = 'BASIC' | 'PRO' | 'PREMIUM';

export type SubscriptionStatus =
  'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export type BillingCycle = 'MONTHLY' | 'ANNUAL';

/** Price per unit per month, in cents (PLAN.md §6). */
export const TIER_PRICES_CENTS: Record<SubscriptionTier, number> = {
  BASIC: 150,
  PRO: 225,
  PREMIUM: 300,
};

/** Annual prepay discount in basis points (1500 bps = 15%). */
export const ANNUAL_DISCOUNT_BPS = 1500;

export const TRIAL_DAYS = 60;

/** A subscription needs at least this many units (PLAN.md §6). */
export const MIN_UNITS = 4;

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  'BASIC',
  'PRO',
  'PREMIUM',
];

export const BILLING_CYCLES: BillingCycle[] = ['MONTHLY', 'ANNUAL'];

/** Total cents charged for one billing period, HALF-UP rounded to a cent (pure). */
export function periodTotalCents(
  tier: SubscriptionTier,
  cycle: BillingCycle,
  unitCount: number,
): number {
  const perUnit = TIER_PRICES_CENTS[tier];
  const monthly = perUnit * unitCount;
  if (cycle === 'MONTHLY') return monthly;
  const annualBase = monthly * 12 * (10000 - ANNUAL_DISCOUNT_BPS);
  return Math.round(annualBase / 10000);
}

export interface SubscriptionDto {
  id: string;
  buildingId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  /** Status after applying trial-expiry rules (may differ from stored status). */
  derivedStatus: SubscriptionStatus;
  billingCycle: BillingCycle;
  units: number;
  pricePerUnitCents: number;
  /** Total cents for the current/next billing period at the stored tier/cycle. */
  nextChargeCents: number;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeTierDto {
  tier: SubscriptionTier;
  billingCycle: BillingCycle;
}

/**
 * Currency-bucket pricing (P0-1, docs/INTERNATIONAL_PLAN §3). The Greek EUR
 * table stays the canonical baseline; other buckets are simple multipliers so
 * the three related pricing surfaces (tier/unit/period) stay in lock-step.
 * Basis points (bps) are used to avoid floating-point drift.
 */
export const CURRENCY_BUCKET_BPS: Record<string, number> = {
  EUR: 10000,
  USD: 10000,
  CAD: 10500,
  MXN: 18000,
  BRL: 9000,
  ARS: 6500,
  CLP: 2500,
  COP: 4000,
  PEN: 8500,
  GBP: 9000,
};

/** Per-unit per-month EUR price for a tier (plan.md §6), in cents. */
export function tierPriceCents(tier: SubscriptionTier): number {
  return TIER_PRICES_CENTS[tier];
}

/**
 * Per-unit per-month price for a tier in the given currency bucket (pure).
 * Unknown currencies fall back to the EUR price unchanged.
 */
export function tierPriceCentsForCurrency(
  tier: SubscriptionTier,
  currency: string,
): number {
  const bucket = CURRENCY_BUCKET_BPS[currency] ?? CURRENCY_BUCKET_BPS['EUR'];
  return Math.round((TIER_PRICES_CENTS[tier] * bucket) / 10000);
}

/**
 * Total cents for one billing period at the currency bucket's per-unit rate:
 * MONTHLY is per-unit; ANNUAL applies the plan.md §6 discount. Pure + integer.
 */
export function periodTotalCentsForCurrency(
  tier: SubscriptionTier,
  cycle: BillingCycle,
  unitCount: number,
  currency: string,
): number {
  const perUnit = tierPriceCentsForCurrency(tier, currency);
  const monthly = perUnit * unitCount;
  if (cycle === 'MONTHLY') return monthly;
  const annualBase = monthly * 12 * (10000 - ANNUAL_DISCOUNT_BPS);
  return Math.round(annualBase / 10000);
}

/**
 * Gated platform features. `voting` and `documents` require PRO or higher;
 * `publicApi` and `accountantExports` require PREMIUM.
 */
export type FeatureFlag =
  'voting' | 'documents' | 'publicApi' | 'accountantExports';

export type FeatureFlags = Record<FeatureFlag, boolean>;

const ALL_LOCKED: FeatureFlags = {
  voting: false,
  documents: false,
  publicApi: false,
  accountantExports: false,
};

export const FEATURES_BY_TIER: Record<SubscriptionTier, FeatureFlags> = {
  BASIC: { ...ALL_LOCKED },
  PRO: { ...ALL_LOCKED, voting: true, documents: true },
  PREMIUM: {
    voting: true,
    documents: true,
    publicApi: true,
    accountantExports: true,
  },
};
