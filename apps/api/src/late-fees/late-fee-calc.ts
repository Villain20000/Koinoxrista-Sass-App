/**
 * Mirrors the shared `LateFeeMode` DTO (`libs/shared/src/lib/late-fees.ts`,
 * exported from the barrel by the orchestrator).
 */
export type LateFeeMode = 'FLAT' | 'PERCENT';

export const MS_PER_DAY = 86_400_000;

/** Inputs of the late-fee amount computation (all integer cents/bps). */
export interface LateFeeCalcSettings {
  mode: LateFeeMode;
  dailyFlatCents: number;
  dailyBps: number;
  capCents: number | null;
}

export interface ComputeLateFeeInput {
  /** Still-unpaid balance of the invoice, in cents. */
  outstandingCents: number;
  /** Chargeable late days (overdue days already past the grace window). */
  daysLate: number;
  setting: LateFeeCalcSettings;
}

/**
 * Pure late-fee amount in cents.
 * FLAT: `dailyFlatCents × daysLate`. PERCENT:
 * `round(outstanding × bps / 10000 × days)`. Capped at `capCents` when set;
 * never negative and never non-integer.
 */
export function computeLateFee({
  outstandingCents,
  daysLate,
  setting,
}: ComputeLateFeeInput): number {
  if (outstandingCents <= 0 || daysLate <= 0) return 0;

  const raw =
    setting.mode === 'PERCENT'
      ? Math.round((outstandingCents * setting.dailyBps * daysLate) / 10_000)
      : setting.dailyFlatCents * daysLate;

  const capped =
    setting.capCents !== null ? Math.min(raw, setting.capCents) : raw;

  return Math.max(0, capped);
}

/**
 * The moment an invoice for `YYYY-MM` becomes due: the first instant after its
 * period month ends (UTC). Invoices carry no explicit due date; the period
 * month-end is the canonical dues deadline.
 */
export function dueMomentForPeriod(periodYearMonth: string): Date {
  const [year, month] = periodYearMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1));
}

/** Whole (floored) days from `earlier` to `later`; negative when `later` is before. */
export function wholeDaysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / MS_PER_DAY);
}
