export interface RunExpenseShareInput {
  unitId: string;
  amountCents: number;
}

export interface RunExpenseInput {
  shares: RunExpenseShareInput[];
}

export interface UnitRunTotal {
  unitId: string;
  totalCents: number;
}

/**
 * Pure helper: aggregates share amounts across all expenses of a billing
 * period into one total per unit. Output is sorted by unitId and always
 * sums to exactly the sum of all input share amounts.
 */
export function aggregateRun(
  expenses: RunExpenseInput[],
): UnitRunTotal[] {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    for (const share of expense.shares) {
      totals.set(share.unitId, (totals.get(share.unitId) ?? 0) + share.amountCents);
    }
  }
  return [...totals.entries()]
    .map(([unitId, totalCents]) => ({ unitId, totalCents }))
    .sort((a, b) => (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
}
