import {
  computeLateFee,
  dueMomentForPeriod,
  wholeDaysBetween,
} from './late-fee-calc';

const flat = (dailyFlatCents: number, capCents: number | null = null) => ({
  mode: 'FLAT' as const,
  dailyFlatCents,
  dailyBps: 0,
  capCents,
});

const percent = (dailyBps: number, capCents: number | null = null) => ({
  mode: 'PERCENT' as const,
  dailyFlatCents: 0,
  dailyBps,
  capCents,
});

describe('computeLateFee', () => {
  it('multiplies the flat daily rate by chargeable days', () => {
    expect(
      computeLateFee({ outstandingCents: 50_000, daysLate: 7, setting: flat(250) }),
    ).toBe(1_750);
  });

  it('rounds the percent-of-outstanding accrual to whole cents', () => {
    // 33417 cents × 50bps (0.5%) × 3 days = 501.255 → 501
    expect(
      computeLateFee({
        outstandingCents: 33_417,
        daysLate: 3,
        setting: percent(50),
      }),
    ).toBe(501);
    // exact division stays exact: 10000 × 100bps (1%) × 1 day = 100
    expect(
      computeLateFee({
        outstandingCents: 10_000,
        daysLate: 1,
        setting: percent(100),
      }),
    ).toBe(100);
  });

  it('caps a single charge at capCents when set', () => {
    expect(
      computeLateFee({
        outstandingCents: 80_000,
        daysLate: 30,
        setting: flat(500, 2_000),
      }),
    ).toBe(2_000);
    expect(
      computeLateFee({
        outstandingCents: 80_000,
        daysLate: 30,
        setting: percent(500, 5_000),
      }),
    ).toBe(5_000);
  });

  it('returns 0 for zero/negative inputs', () => {
    expect(computeLateFee({ outstandingCents: 0, daysLate: 9, setting: flat(250) })).toBe(0);
    expect(
      computeLateFee({ outstandingCents: -5, daysLate: 9, setting: flat(250) }),
    ).toBe(0);
    expect(
      computeLateFee({ outstandingCents: 10_000, daysLate: 0, setting: flat(250) }),
    ).toBe(0);
    expect(
      computeLateFee({ outstandingCents: 10_000, daysLate: -3, setting: flat(250) }),
    ).toBe(0);
  });
});

describe('dueMomentForPeriod / wholeDaysBetween', () => {
  it('places the due moment at the first instant after the period ends', () => {
    expect(dueMomentForPeriod('2026-06').toISOString()).toBe(
      '2026-07-01T00:00:00.000Z',
    );
    // year rollover: December is due on Jan 1 of the next year
    expect(dueMomentForPeriod('2026-12').toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('counts whole elapsed days, flooring partial days', () => {
    const due = dueMomentForPeriod('2026-06');
    expect(wholeDaysBetween(new Date('2026-07-11T00:00:00.000Z'), due)).toBe(10);
    expect(wholeDaysBetween(new Date('2026-07-01T12:00:00.000Z'), due)).toBe(0);
    expect(wholeDaysBetween(new Date('2026-06-30T00:00:00.000Z'), due)).toBe(-1);
  });
});
