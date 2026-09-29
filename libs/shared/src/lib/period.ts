const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Returns `true` when `value` matches `YYYY-MM` with a valid month. */
export function isValidPeriod(value: string): boolean {
  return PERIOD_REGEX.test(value);
}

/** Formats a date as `YYYY-MM` in UTC. */
export function formatPeriod(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Parses `YYYY-MM` into `{ year, month }` (month is 1-based). Throws on invalid input. */
export function parsePeriod(value: string): { year: number; month: number } {
  if (!isValidPeriod(value)) {
    throw new Error(`invalid period "${value}", expected YYYY-MM`);
  }
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

/** Returns the next period after `value` (`2025-12` → `2026-01`). */
export function nextPeriod(value: string): string {
  const { year, month } = parsePeriod(value);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}
