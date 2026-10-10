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

export type RunPayer = 'OCCUPANT' | 'OWNER';

export interface RunExpenseWithPayerInput extends RunExpenseInput {
  /** Missing → OCCUPANT (legacy rows before the charge-payer migration). */
  chargeTo?: RunPayer | null;
}

export interface UnitPayerRunTotal {
  unitId: string;
  payer: RunPayer;
  totalCents: number;
}

/**
 * Pure helper: like aggregateRun but keeps occupant (ένοικος) and owner
 * (ιδιοκτήτης) charges apart, so each payer gets its own invoice. Output is
 * sorted by unitId then payer (OCCUPANT first); amounts still sum exactly to
 * the input shares.
 */
export function aggregateRunByPayer(
  expenses: RunExpenseWithPayerInput[],
): UnitPayerRunTotal[] {
  const totals = new Map<string, UnitPayerRunTotal>();
  for (const expense of expenses) {
    const payer: RunPayer = expense.chargeTo ?? 'OCCUPANT';
    for (const share of expense.shares) {
      const key = `${share.unitId}|${payer}`;
      const entry = totals.get(key) ?? { unitId: share.unitId, payer, totalCents: 0 };
      entry.totalCents += share.amountCents;
      totals.set(key, entry);
    }
  }
  const order: Record<RunPayer, number> = { OCCUPANT: 0, OWNER: 1 };
  return [...totals.values()].sort((a, b) =>
    a.unitId === b.unitId
      ? order[a.payer] - order[b.payer]
      : a.unitId < b.unitId
        ? -1
        : 1,
  );
}
