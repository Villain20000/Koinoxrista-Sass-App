/** Default platform take rate: 4% of the awarded amount. */
export const DEFAULT_COMMISSION_RATE_BPS = 400;

/** Default per-commission cap: €500. */
export const DEFAULT_COMMISSION_CAP_CENTS = 50_000;

export interface CommissionSettings {
  rateBps: number;
  capCents: number;
}

/**
 * Platform commission in integer cents for an awarded amount.
 * `round(amount × rate / 10 000)` with exact half-up rounding (pure integer
 * math, no float drift), capped at `capCents`; never negative.
 */
export function computeCommission(
  amountCents: number,
  rateBps: number,
  capCents: number,
): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  if (!Number.isFinite(rateBps) || rateBps <= 0) return 0;

  const raw = Math.floor(
    (Math.round(amountCents) * Math.round(rateBps) + 5_000) / 10_000,
  );
  return Math.max(0, Math.min(raw, capCents));
}

/**
 * Reads the commission settings from the environment with built-in defaults:
 * `COMMISSION_RATE_BPS` (default 400) and `COMMISSION_CAP_CENTS` (default
 * 50 000). Invalid or non-positive values fall back to the defaults.
 */
export function parseCommissionSettings(
  env: Record<string, string | undefined> = process.env,
): CommissionSettings {
  const rateBps = Number.parseInt(env.COMMISSION_RATE_BPS ?? '', 10);
  const capCents = Number.parseInt(env.COMMISSION_CAP_CENTS ?? '', 10);
  return {
    rateBps:
      Number.isFinite(rateBps) && rateBps > 0
        ? rateBps
        : DEFAULT_COMMISSION_RATE_BPS,
    capCents:
      Number.isFinite(capCents) && capCents >= 0
        ? capCents
        : DEFAULT_COMMISSION_CAP_CENTS,
  };
}
