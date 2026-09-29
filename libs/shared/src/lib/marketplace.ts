/**
 * Marketplace monetization (platform take-rate + featured placements).
 *
 * Commission lifecycle: an ADMIN awarding a bid persists ONE `JobCommission`
 * per awarded job (`DUE` → `PAID` via mark-paid, or `WAIVED`).
 */
export type JobCommissionStatus = 'DUE' | 'PAID' | 'WAIVED';

/** Platform commission persisted when an admin awards a bid. */
export interface JobCommissionDto {
  id: string;
  buildingId: string;
  jobId: string;
  providerId: string;
  /** Awarded bid amount the commission was computed from, in cents. */
  baseCents: number;
  /** Take rate in basis points (400 = 4%). */
  rateBps: number;
  /** Commission amount in cents (rounded half-up, after the cap). */
  amountCents: number;
  status: JobCommissionStatus;
  /** ISO datetime when the platform fee was settled; null while DUE/WAIVED. */
  paidAt: string | null;
  createdAt?: string;
  /** Denormalized for listing views. */
  jobTitle?: string | null;
  providerName?: string | null;
}

/** Query filters for `GET /buildings/:buildingId/commissions`. */
export interface ListCommissionsQuery {
  status?: JobCommissionStatus;
}

/** One month of the yearly commissionable-volume summary. */
export interface CommissionSummaryMonthDto {
  /** `YYYY-MM`. */
  month: string;
  awardedCents: number;
  commissionCents: number;
}

export interface CommissionSummaryDto {
  year: number;
  /** Always twelve entries, `YYYY-01`…`YYYY-12`, zero-filled. */
  months: CommissionSummaryMonthDto[];
  totals: {
    awardedCents: number;
    commissionCents: number;
  };
}

/** Featured provider placement in a building's directory. */
export interface FeaturedSlotDto {
  id: string;
  buildingId: string;
  providerId: string;
  /** Optional trade narrowing of the placement. */
  trade: string | null;
  startsAt: string;
  endsAt: string;
  createdAt?: string;
  /** Denormalized for listing views. */
  providerName?: string | null;
}

/** Request body for creating a featured slot. */
export interface CreateFeaturedSlotDto {
  providerId: string;
  trade?: string | null;
  /** ISO datetimes; `endsAt` must be after `startsAt`. */
  startsAt: string;
  endsAt: string;
}
