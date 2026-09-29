import type { SubscriptionTier } from './subscriptions';

/** Lifecycle of a platform self-billing invoice. */
export type PlatformInvoiceStatus = 'ISSUED' | 'PAID' | 'VOID';

/**
 * A myDATA-style document the SaaS issues to ITSELF for its own platform fee.
 *
 * `period` is `YYYY-MM` for recurring monthly fees (unique per subscription)
 * and `YYYY-MM-ADJ-<n>` for prorated tier-change deltas inside that month.
 * `tier`/`units` are snapshots taken at issuance time.
 */
export interface PlatformInvoiceDto {
  id: string;
  buildingId: string;
  subscriptionId: string | null;
  /** Human document number, `SI-<year>-<seq>` (e.g. `SI-2026-0001`). */
  number: string;
  period: string;
  tier: SubscriptionTier;
  units: number;
  amountCents: number;
  status: PlatformInvoiceStatus;
  issuedAt: string;
  paidAt: string | null;
}

/** Result of an idempotent `run-period` invocation. */
export interface RunPeriodResponseDto {
  /** `false` when an invoice for this period already existed. */
  created: boolean;
  invoice: PlatformInvoiceDto | null;
}
