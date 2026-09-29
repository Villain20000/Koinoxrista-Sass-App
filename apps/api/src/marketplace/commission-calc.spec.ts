import {
  computeCommission,
  DEFAULT_COMMISSION_CAP_CENTS,
  DEFAULT_COMMISSION_RATE_BPS,
  parseCommissionSettings,
} from './commission-calc';

describe('computeCommission', () => {
  it('applies the default 4% rate to whole-cent amounts', () => {
    // €10 000,00 → 4% = €400,00
    expect(computeCommission(1_000_000, 400, 50_000)).toBe(40_000);
    expect(computeCommission(10_000, 400, 50_000)).toBe(400);
  });

  it('rounds half-up to integer cents with exact integer math', () => {
    // 1¢ × 50% = 0.5¢ → rounds UP to 1
    expect(computeCommission(1, 5_000, 50_000)).toBe(1);
    // 3¢ × 33.33% = 0.9999¢ → rounds up to 1
    expect(computeCommission(3, 3_333, 50_000)).toBe(1);
    // 12345 × 40% = 493.8 → 494
    expect(computeCommission(12_345, 400, 50_000)).toBe(494);
    // Just below the half boundary stays down: 101 × 400bps = 4.04 → 4
    expect(computeCommission(101, 400, 50_000)).toBe(4);
  });

  it('caps the commission at the configured ceiling', () => {
    // €100 000 at 4% = €4 000 but capped at €500
    expect(computeCommission(10_000_000, 400, 50_000)).toBe(50_000);
    // Cap applies after rounding
    expect(computeCommission(2_000_000, 400, 500)).toBe(500);
  });

  it('returns 0 for zero/negative amounts or zero rate', () => {
    expect(computeCommission(0, 400, 50_000)).toBe(0);
    expect(computeCommission(-5_000, 400, 50_000)).toBe(0);
    expect(computeCommission(5_000, 0, 50_000)).toBe(0);
    expect(computeCommission(5_000, -100, 50_000)).toBe(0);
    expect(computeCommission(Number.NaN, 400, 50_000)).toBe(0);
  });

  it('handles a zero cap by always returning zero', () => {
    expect(computeCommission(1_000_000, 400, 0)).toBe(0);
  });
});

describe('parseCommissionSettings', () => {
  it('falls back to the built-in defaults on missing env', () => {
    expect(parseCommissionSettings({})).toEqual({
      rateBps: DEFAULT_COMMISSION_RATE_BPS,
      capCents: DEFAULT_COMMISSION_CAP_CENTS,
    });
    expect(DEFAULT_COMMISSION_RATE_BPS).toBe(400);
    expect(DEFAULT_COMMISSION_CAP_CENTS).toBe(50_000);
  });

  it('honors valid env overrides', () => {
    expect(
      parseCommissionSettings({
        COMMISSION_RATE_BPS: '250',
        COMMISSION_CAP_CENTS: '20000',
      }),
    ).toEqual({ rateBps: 250, capCents: 20_000 });
  });

  it('rejects invalid overrides and keeps the defaults', () => {
    expect(
      parseCommissionSettings({
        COMMISSION_RATE_BPS: 'not-a-number',
        COMMISSION_CAP_CENTS: '-1',
      }),
    ).toEqual({ rateBps: 400, capCents: 50_000 });
    expect(
      parseCommissionSettings({
        COMMISSION_RATE_BPS: '0',
        COMMISSION_CAP_CENTS: '0',
      }),
    ).toEqual({ rateBps: 400, capCents: 0 });
  });
});
