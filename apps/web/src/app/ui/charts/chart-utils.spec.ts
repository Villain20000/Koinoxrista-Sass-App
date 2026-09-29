import {
  barHeight,
  maxOfSeries,
  pctOfMax,
  truncateLabel,
} from './chart-utils';

describe('maxOfSeries', () => {
  it('returns the largest value across series', () => {
    expect(maxOfSeries([[3, 9, 1], [4], [12, 0]])).toBe(12);
  });

  it('handles empty and missing series', () => {
    expect(maxOfSeries([])).toBe(0);
    expect(maxOfSeries([[], undefined, null])).toBe(0);
    expect(maxOfSeries([[-5, -2]])).toBe(0);
  });
});

describe('barHeight', () => {
  it('scales values proportionally to the plot height', () => {
    expect(barHeight(50, 100, 200)).toBe(100);
    expect(barHeight(1, 400, 200)).toBe(1);
  });

  it('guards zero max, negative values and zero plot', () => {
    expect(barHeight(10, 0, 200)).toBe(0);
    expect(barHeight(-1, 10, 200)).toBe(0);
    expect(barHeight(10, 10, 0)).toBe(0);
  });
});

describe('truncateLabel', () => {
  it('keeps short labels intact and ellipsises long ones', () => {
    expect(truncateLabel('2026-08')).toBe('2026-08');
    expect(truncateLabel('Καθαριότητα', 7)).toBe('Καθαρι…');
  });

  it('handles degenerate widths', () => {
    expect(truncateLabel('anything', 1)).toBe('…');
    expect(truncateLabel('x', 0)).toBe('');
  });
});

describe('pctOfMax', () => {
  it('computes clamped percentages', () => {
    expect(pctOfMax(50, 100)).toBe(50);
    expect(pctOfMax(150, 100)).toBe(100);
    expect(pctOfMax(0, 100)).toBe(0);
    expect(pctOfMax(10, 0)).toBe(0);
  });
});
