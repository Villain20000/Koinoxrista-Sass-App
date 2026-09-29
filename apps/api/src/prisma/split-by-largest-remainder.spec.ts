import {
  SplitInput,
  splitByLargestRemainder,
} from './split-by-largest-remainder';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('splitByLargestRemainder', () => {
  it('keeps the exact seed scenario consistent (48000 cents over millimes)', () => {
    const millimes = [120, 120, 100, 100, 80, 80, 80, 80, 60, 60, 60, 60];
    const inputs: SplitInput[] = millimes.map((millimes_, index) => ({
      id: `unit-${index}`,
      weight: millimes_,
    }));

    const result = splitByLargestRemainder(48000, inputs);

    expect(result).toHaveLength(12);
    expect(result.reduce((sum, part) => sum + part.amountCents, 0)).toBe(
      48000,
    );
    expect(result.every((part) => Number.isInteger(part.amountCents))).toBe(
      true,
    );
  });

  it('always sums to totalCents across randomized inputs', () => {
    const random = mulberry32(20260822);

    for (let iteration = 0; iteration < 500; iteration++) {
      const totalCents = Math.floor(random() * 1_000_000);
      const partsCount = 1 + Math.floor(random() * 50);
      const inputs: SplitInput[] = Array.from({ length: partsCount }, (_, i) => ({
        id: `w-${i}`,
        weight: 1 + Math.floor(random() * 1000),
      }));

      const result = splitByLargestRemainder(totalCents, inputs);
      const sum = result.reduce((acc, part) => acc + part.amountCents, 0);

      if (sum !== totalCents) {
        fail(
          `case ${iteration}: expected sum ${totalCents}, got ${sum}` +
            ` (parts=${partsCount})`,
        );
      }
      expect(sum).toBe(totalCents);
      expect(result.map((part) => part.id)).toEqual(inputs.map((i) => i.id));
      result.forEach((part) => {
        expect(part.amountCents).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(part.amountCents)).toBe(true);
      });
    }
  });

  it('handles edge cases without losing cents', () => {
    expect(splitByLargestRemainder(0, [{ id: 'a', weight: 10 }])).toEqual([
      { id: 'a', amountCents: 0 },
    ]);
    expect(
      splitByLargestRemainder(1, [
        { id: 'a', weight: 1 },
        { id: 'b', weight: 1 },
      ]).reduce((s, p) => s + p.amountCents, 0),
    ).toBe(1);
    expect(splitByLargestRemainder(100, [])).toEqual([]);
  });
});
