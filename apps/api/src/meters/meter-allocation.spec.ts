import { BadRequestException } from '@nestjs/common';

import {
  isMetersStrategy,
  splitByMeterReading,
  validateAllUnitsHaveReadings,
} from './meter-allocation';

describe('splitByMeterReading', () => {
  it('splits proportionally to consumption with Σ shares = total', () => {
    const shares = splitByMeterReading(1000, [
      { unitId: 'unit-a', consumed: 600 },
      { unitId: 'unit-b', consumed: 400 },
    ]);

    expect(shares).toEqual([
      { unitId: 'unit-a', amountCents: 600 },
      { unitId: 'unit-b', amountCents: 400 },
    ]);
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1000);
  });

  it('distributes remainder cents by largest fraction (1001 over three equal units)', () => {
    const shares = splitByMeterReading(1001, [
      { unitId: 'unit-a', consumed: 1 },
      { unitId: 'unit-b', consumed: 1 },
      { unitId: 'unit-c', consumed: 1 },
    ]);

    expect(shares.map((s) => s.amountCents)).toEqual([334, 334, 333]);
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
  });

  it('breaks ties by input order, mirroring splitByLargestRemainder', () => {
    const shares = splitByMeterReading(101, [
      { unitId: 'second', consumed: 7 },
      { unitId: 'first', consumed: 7 },
      { unitId: 'third', consumed: 6 },
    ]);

    // Exact quarters are impossible; fractions tie between `second`/`first`
    // and the single remainder cent goes to the earliest input order.
    expect(shares.map((s) => s.amountCents)).toEqual([36, 35, 30]);
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(101);
  });

  it('keeps zero-consumption units in the output with 0 cents', () => {
    const shares = splitByMeterReading(999, [
      { unitId: 'unit-a', consumed: 500 },
      { unitId: 'unit-idle', consumed: 0 },
      { unitId: 'unit-b', consumed: 500 },
    ]);

    expect(shares).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitId: 'unit-idle', amountCents: 0 }),
        expect.objectContaining({ unitId: 'unit-a', amountCents: 500 }),
        expect.objectContaining({ unitId: 'unit-b', amountCents: 499 }),
      ]),
    );
    expect(shares).toHaveLength(3);
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(999);
  });

  it('returns an empty array when there are no readings', () => {
    expect(splitByMeterReading(100, [])).toEqual([]);
  });

  it('rejects an all-zero-consumption run with a clear message', () => {
    expect(() =>
      splitByMeterReading(100, [
        { unitId: 'unit-a', consumed: 0 },
        { unitId: 'unit-b', consumed: 0 },
      ]),
    ).toThrow(
      new BadRequestException(
        'METERS strategy requires at least one unit with consumption > 0',
      ),
    );
  });

  it('rejects negative or fractional consumption and invalid totals', () => {
    expect(() =>
      splitByMeterReading(-1, [{ unitId: 'unit-a', consumed: 10 }]),
    ).toThrow('totalCents must be a non-negative integer');
    expect(() =>
      splitByMeterReading(100.5, [{ unitId: 'unit-a', consumed: 10 }]),
    ).toThrow('totalCents must be a non-negative integer');
    expect(() =>
      splitByMeterReading(100, [{ unitId: 'unit-a', consumed: -5 }]),
    ).toThrow('consumed must be non-negative integers');
    expect(() =>
      splitByMeterReading(100, [{ unitId: 'unit-a', consumed: 2.5 }]),
    ).toThrow('consumed must be non-negative integers');
  });
});

describe('validateAllUnitsHaveReadings', () => {
  it('passes when every unit has at least one reading', () => {
    expect(() =>
      validateAllUnitsHaveReadings(
        ['unit-a', 'unit-b'],
        [{ unitId: 'unit-b' }, { unitId: 'unit-a' }, { unitId: 'unit-a' }],
      ),
    ).not.toThrow();
  });

  it('throws listing exactly the units without readings', () => {
    expect(() =>
      validateAllUnitsHaveReadings(
        ['unit-a', 'unit-b', 'unit-c'],
        [{ unitId: 'unit-a' }],
      ),
    ).toThrow(
      new BadRequestException(
        'METERS strategy requires a reading for every unit; units missing readings: unit-b, unit-c',
      ),
    );
  });

  it('throws listing all units when there are no readings at all', () => {
    expect(() =>
      validateAllUnitsHaveReadings(['unit-a', 'unit-b'], []),
    ).toThrow(/units missing readings: unit-a, unit-b/);
  });
});

describe('isMetersStrategy', () => {
  it('matches only the METERS literal', () => {
    expect(isMetersStrategy('METERS')).toBe(true);
    expect(isMetersStrategy('MILIMES')).toBe(false);
  });
});
