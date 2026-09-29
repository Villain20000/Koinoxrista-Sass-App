import { BadRequestException } from '@nestjs/common';

import { MIN_UNITS } from '@org/shared';

import { assertMinimumUnits, priceFor, prorateDelta } from './pricing';

describe('subscriptions pricing', () => {
  describe('priceFor', () => {
    it('charges per unit monthly', () => {
      expect(priceFor('BASIC', 'MONTHLY', 10)).toBe(1500);
      expect(priceFor('PRO', 'MONTHLY', 4)).toBe(900);
      expect(priceFor('PREMIUM', 'MONTHLY', 25)).toBe(7500);
    });

    it('applies the annual discount with exact integer cents', () => {
      expect(priceFor('PRO', 'ANNUAL', 20)).toBe(45900);
      expect(priceFor('BASIC', 'ANNUAL', 4)).toBe(6120);
      expect(priceFor('PREMIUM', 'ANNUAL', 7)).toBe(21420);
    });

    it('always yields integer cents across tiers, cycles and sizes', () => {
      const tiers = ['BASIC', 'PRO', 'PREMIUM'] as const;
      const cycles = ['MONTHLY', 'ANNUAL'] as const;
      for (const tier of tiers) {
        for (const cycle of cycles) {
          for (let units = MIN_UNITS; units <= 40; units++) {
            expect(Number.isInteger(priceFor(tier, cycle, units))).toBe(true);
          }
        }
      }
    });
  });

  describe('assertMinimumUnits', () => {
    it('accepts the minimum and above', () => {
      expect(() => assertMinimumUnits(MIN_UNITS)).not.toThrow();
      expect(() => assertMinimumUnits(12)).not.toThrow();
    });

    it('rejects smaller buildings with a clear error', () => {
      expect(() => assertMinimumUnits(3)).toThrow(BadRequestException);
      expect(() => assertMinimumUnits(3)).toThrow(
        'Subscription requires at least 4 units',
      );
      expect(() => assertMinimumUnits(0)).toThrow(BadRequestException);
    });
  });

  describe('prorateDelta', () => {
    it('charges the remaining-days difference on upgrades', () => {
      expect(prorateDelta('BASIC', 'PREMIUM', 10, 30, 6)).toBe(600);
      expect(prorateDelta('BASIC', 'PRO', 0, 30, 4)).toBe(300);
      expect(prorateDelta('PRO', 'PREMIUM', 15, 30, 8)).toBe(300);
    });

    it('clamps downgrades to zero instead of crediting', () => {
      expect(prorateDelta('PREMIUM', 'BASIC', 10, 30, 6)).toBe(0);
      expect(prorateDelta('PRO', 'BASIC', 1, 30, 12)).toBe(0);
    });

    it('rounds HALF-UP to integer cents', () => {
      // (225 - 150) * 5 * 29 / 30 = 362.5
      expect(prorateDelta('BASIC', 'PRO', 1, 30, 5)).toBe(363);
    });

    it('yields zero at period end and for degenerate windows', () => {
      expect(prorateDelta('BASIC', 'PREMIUM', 30, 30, 6)).toBe(0);
      expect(prorateDelta('BASIC', 'PREMIUM', 5, 0, 6)).toBe(0);
      expect(prorateDelta('BASIC', 'BASIC', 10, 30, 6)).toBe(0);
    });
  });
});
