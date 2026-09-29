/** Largest value across one or more series; 0 for empty input (pure). */
export function maxOfSeries(series: Array<number[] | null | undefined>): number {
  let max = 0;
  for (const values of series) {
    if (!values) continue;
    for (const value of values) {
      if (value > max) max = value;
    }
  }
  return max;
}

/** Pixel height of a bar scaled into the plot area, min 1px when positive (pure). */
export function barHeight(
  value: number,
  maxValue: number,
  plotHeightPx: number,
): number {
  if (maxValue <= 0 || value <= 0 || plotHeightPx <= 0) return 0;
  return Math.max(1, Math.round((value / maxValue) * plotHeightPx));
}

/** Shortens a label to fit under a bar column, ellipsising the tail (pure). */
export function truncateLabel(label: string, maxChars = 7): string {
  if (maxChars < 1) return '';
  return label.length <= maxChars ? label : `${label.slice(0, maxChars - 1)}…`;
}

/** Percentage of `value` relative to `max`, clamped to [0..100] (pure). */
export function pctOfMax(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}
