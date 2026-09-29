import { monthlyFeeCents, monthsToCentsDiscount, planCreditRedemption } from './referral-calc';

describe('referral-calc', () => {
  describe('monthlyFeeCents', () => {
    it('reuses the subscriptions MONTHLY pricing', () => {
      expect(monthlyFeeCents('BASIC', 4)).toBe(600);
      expect(monthlyFeeCents('PRO', 10)).toBe(2250);
      expect(monthlyFeeCents('PREMIUM', 25)).toBe(7500);
    });
  });

  describe('monthsToCentsDiscount', () => {
    it('values whole months at the monthly fee', () => {
      expect(monthsToCentsDiscount(1, 'BASIC', 4)).toBe(600);
      expect(monthsToCentsDiscount(3, 'PRO', 10)).toBe(6750);
    });

    it('yields zero for non-positive or fractional garbage input', () => {
      expect(monthsToCentsDiscount(0, 'BASIC', 4)).toBe(0);
      expect(monthsToCentsDiscount(-2, 'BASIC', 4)).toBe(0);
      expect(Number.isNaN(monthsToCentsDiscount(NaN, 'BASIC', 4))).toBe(false);
    });
  });

  describe('planCreditRedemption', () => {
    it('consumes whole months up to the charge', () => {
      // BASIC × 4 = €6/month; charge €12 → 2 months.
      const plan = planCreditRedemption(1200, 5, 'BASIC', 4);
      expect(plan).toEqual({ monthsConsumed: 2, discountCents: 1200 });
    });

    it('caps consumption by available credits', () => {
      const plan = planCreditRedemption(1200, 1, 'BASIC', 4);
      expect(plan).toEqual({ monthsConsumed: 1, discountCents: 600 });
    });

    it('redeems nothing when the charge is smaller than one month (no partial burn)', () => {
      const plan = planCreditRedemption(500, 3, 'BASIC', 4);
      expect(plan).toEqual({ monthsConsumed: 0, discountCents: 0 });
    });

    it('never discounts a zero-charge (TRIALING/CANCELLED) invoice', () => {
      expect(planCreditRedemption(0, 3, 'BASIC', 4)).toEqual({
        monthsConsumed: 0,
        discountCents: 0,
      });
      expect(planCreditRedemption(-100, 3, 'BASIC', 4)).toEqual({
        monthsConsumed: 0,
        discountCents: 0,
      });
    });

    it('handles exact multiples and fractional leftovers as floor months', () => {
      // PRO × 10 = €22.50/month; €45 → exactly 2 months.
      expect(planCreditRedemption(4500, 9, 'PRO', 10)).toEqual({
        monthsConsumed: 2,
        discountCents: 4500,
      });
      // €34 → 1 whole month only.
      expect(planCreditRedemption(3400, 9, 'PRO', 10)).toEqual({
        monthsConsumed: 1,
        discountCents: 2250,
      });
    });
  });
});
