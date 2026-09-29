import { aggregateRun, RunExpenseInput } from './run-invoices';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 1);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

describe('aggregateRun', () => {
  it('returns an empty array for an empty period', () => {
    expect(aggregateRun([])).toEqual([]);
  });

  it('returns an empty array when expenses carry no shares', () => {
    expect(aggregateRun([{ shares: [] }, { shares: [] }])).toEqual([]);
  });

  it('aggregates shares of a single expense per unit', () => {
    const result = aggregateRun([
      {
        shares: [
          { unitId: 'u1', amountCents: 1200 },
          { unitId: 'u2', amountCents: 800 },
        ],
      },
    ]);

    expect(result).toEqual([
      { unitId: 'u1', totalCents: 1200 },
      { unitId: 'u2', totalCents: 800 },
    ]);
  });

  it('sums multiple expenses/categories hitting the same unit', () => {
    const result = aggregateRun([
      { shares: [{ unitId: 'u1', amountCents: 500 }] },
      { shares: [{ unitId: 'u1', amountCents: 250 }, { unitId: 'u2', amountCents: 100 }] },
      { shares: [{ unitId: 'u1', amountCents: 25 }] },
    ]);

    expect(result).toEqual([
      { unitId: 'u1', totalCents: 775 },
      { unitId: 'u2', totalCents: 100 },
    ]);
  });

  it('keeps the output sorted by unitId regardless of input order', () => {
    const result = aggregateRun([
      { shares: [{ unitId: 'c', amountCents: 3 }] },
      { shares: [{ unitId: 'a', amountCents: 1 }] },
      { shares: [{ unitId: 'b', amountCents: 2 }] },
    ]);

    expect(result.map((entry) => entry.unitId)).toEqual(['a', 'b', 'c']);
  });

  it('always preserves the exact total across randomized inputs', () => {
    const random = mulberry32(20260824);

    for (let iteration = 0; iteration < 300; iteration++) {
      const unitCount = 1 + Math.floor(random() * 12);
      const expenseCount = Math.floor(random() * 8);
      const expenses: RunExpenseInput[] = [];

      let expectedTotal = 0;
      for (let e = 0; e < expenseCount; e++) {
        const shares = Array.from({ length: unitCount }, (_, u) => {
          const amountCents = Math.floor(random() * 10_000);
          expectedTotal += amountCents;
          return { unitId: `unit-${u}`, amountCents };
        });
        expenses.push({ shares });
      }

      const result = aggregateRun(expenses);

      const sum = result.reduce((acc, entry) => acc + entry.totalCents, 0);
      expect(sum).toBe(expectedTotal);
      if (expenseCount > 0) {
        expect(result).toHaveLength(unitCount);
      }
    }
  });

  it('is deterministic for identical inputs', () => {
    const expenses: RunExpenseInput[] = [
      { shares: [{ unitId: 'u1', amountCents: 123 }, { unitId: 'u2', amountCents: 321 }] },
      { shares: [{ unitId: 'u1', amountCents: 7 }] },
    ];

    expect(aggregateRun(expenses)).toEqual(aggregateRun([...expenses].reverse()));
  });
});
