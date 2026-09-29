/**
 * Referral program ("Συστάσεις"): every building gets a short code
 * (`BLD-XXXXXX`). A new building signing up through `?ref=CODE` earns 3 free
 * trial months; the referring building earns 1 month of platform-fee credit.
 * Both rewards are stored as ReferralCredit rows that the self-billing
 * recurring run consumes as invoice discounts.
 */

/** Short public code shown in links; unambiguous alphabet, `BLD-` prefix. */
export const REFERRAL_CODE_PATTERN = /^BLD-[A-Z0-9]{6}$/;

export const REFERRAL_REFERRED_MONTHS = 3;
export const REFERRAL_REFERRER_MONTHS = 1;

/** Why a credit row exists. */
export type ReferralReason = 'REFERRED' | 'REFERRER';

/** sessionStorage key used to carry `?ref=` from /register to activation. */
export const REFERRAL_STORAGE_KEY = 'polykatoikiaos.referralCode';

export interface ReferralCreditDto {
  id: string;
  /** Owner building of the credit (the one that may spend it). */
  buildingId: string;
  sourceBuildingId: string | null;
  code: string;
  months: number;
  reason: ReferralReason;
  usedAt: string | null;
  /** Platform-invoice period (`YYYY-MM`) that consumed this credit. */
  usedPeriod: string | null;
  createdAt: string;
}

/** GET /buildings/:buildingId/referrals */
export interface ReferralInfoDto {
  code: string | null;
  /** Absolute base URL of the signup page; append `?ref=<code>`. */
  referralUrlBase: string;
  credits: ReferralCreditDto[];
}

/** POST /buildings/:buildingId/referrals/rotate-code */
export interface RotateReferralCodeResponseDto {
  code: string;
}

/** POST /subscriptions/activate body (referral handoff from registration). */
export interface ActivateSubscriptionDto {
  referralCode?: string;
}

/** Normalizes user-typed codes (`bld-ab12cd` → `BLD-AB12CD`); null if malformed. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}
