export interface LedgerShareInput {
  unitId: string;
  amountCents: number;
}

export interface LedgerExpenseInput {
  description: string;
  periodYearMonth: string;
  shares: LedgerShareInput[];
}

export interface LedgerUnitInput {
  id: string;
  label: string;
}

export interface LedgerInvoiceInput {
  unitId: string;
  periodYearMonth: string;
  paidCents: number;
}

export interface LedgerRow {
  periodYearMonth: string;
  unitLabel: string;
  description: string;
  invoicedCents: number;
  paidCents: number;
  balanceCents: number;
}

/**
 * Pure helper: builds ledger rows per (period, unit, expense description).
 * Each unit-period's invoice payments are allocated to its rows in order, so
 * row balances sum exactly to the invoice balance for every (unit, period).
 */
export function buildLedgerRows(
  year: string,
  expenses: LedgerExpenseInput[],
  units: LedgerUnitInput[],
  invoices: LedgerInvoiceInput[],
): LedgerRow[] {
  const labelByUnitId = new Map(units.map((unit) => [unit.id, unit.label]));
  const paidByKey = new Map<string, number>();
  for (const invoice of invoices) {
    const key = `${invoice.unitId}|${invoice.periodYearMonth}`;
    paidByKey.set(key, (paidByKey.get(key) ?? 0) + invoice.paidCents);
  }

  interface LedgerGroup {
    periodYearMonth: string;
    unitId: string;
    unitLabel: string;
    description: string;
    invoicedCents: number;
  }

  const groups = new Map<string, LedgerGroup>();
  const order: LedgerGroup[] = [];

  for (const expense of expenses) {
    if (!expense.periodYearMonth.startsWith(`${year}-`)) continue;
    for (const share of expense.shares) {
      const unitLabel = labelByUnitId.get(share.unitId);
      if (unitLabel === undefined) continue;
      const periodYearMonth = expense.periodYearMonth;
      const key = `${periodYearMonth}|${share.unitId}|${expense.description}`;
      const group = groups.get(key);
      if (group) {
        group.invoicedCents += share.amountCents;
      } else {
        const created: LedgerGroup = {
          periodYearMonth,
          unitId: share.unitId,
          unitLabel,
          description: expense.description,
          invoicedCents: share.amountCents,
        };
        groups.set(key, created);
        order.push(created);
      }
    }
  }

  order.sort(
    (a, b) =>
      a.periodYearMonth.localeCompare(b.periodYearMonth) ||
      a.unitLabel.localeCompare(b.unitLabel) ||
      a.description.localeCompare(b.description),
  );

  const remainingPaidByKey = new Map(paidByKey);
  return order.map((group) => {
    const paidKey = `${group.unitId}|${group.periodYearMonth}`;
    const paidLeft = remainingPaidByKey.get(paidKey) ?? 0;
    const allocated = Math.max(0, Math.min(paidLeft, group.invoicedCents));
    remainingPaidByKey.set(paidKey, paidLeft - allocated);
    return {
      periodYearMonth: group.periodYearMonth,
      unitLabel: group.unitLabel,
      description: group.description,
      invoicedCents: group.invoicedCents,
      paidCents: allocated,
      balanceCents: group.invoicedCents - allocated,
    };
  });
}

export function ledgerTotals(rows: LedgerRow[]): {
  invoicedCents: number;
  paidCents: number;
  balanceCents: number;
} {
  return rows.reduce(
    (totals, row) => ({
      invoicedCents: totals.invoicedCents + row.invoicedCents,
      paidCents: totals.paidCents + row.paidCents,
      balanceCents: totals.balanceCents + row.balanceCents,
    }),
    { invoicedCents: 0, paidCents: 0, balanceCents: 0 },
  );
}
