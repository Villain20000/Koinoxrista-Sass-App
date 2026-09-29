import { buildLedgerRows, ledgerTotals } from './build-ledger';

export interface StatementRow {
  periodYearMonth: string;
  description: string;
  invoicedCents: number;
  paidCents: number;
}

export interface StatementTotals {
  invoicedCents: number;
  paidCents: number;
  balanceCents: number;
}

export interface UnitYearStatement {
  buildingName: string;
  unitLabel: string;
  ownerName?: string;
  year: string;
  rows: StatementRow[];
  totals: StatementTotals;
}

interface StatementExpenseInput {
  description: string;
  periodYearMonth: string;
  shares: { unitId: string; amountCents: number }[];
}

interface StatementInvoiceInput {
  unitId: string;
  periodYearMonth: string;
  paidCents: number;
}

/** Owner display name from ownership users (pure). */
export function ownerDisplayName(
  owners: { firstName?: string | null; lastName?: string | null }[],
): string | undefined {
  const names = [
    ...new Set(
      owners
        .map((owner) =>
          [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim(),
        )
        .filter(Boolean),
    ),
  ];
  return names.length > 0 ? names.join(', ') : undefined;
}

/**
 * Pure helper: builds the annual per-unit statement. Invoiced amounts come
 * from the unit's expense shares, payments are allocated per period exactly
 * like the ledger (buildLedgerRows), so totals reconcile with invoices.
 */
export function buildUnitStatement(input: {
  buildingName: string;
  unitId: string;
  unitLabel: string;
  ownerName?: string;
  year: string;
  expenses: StatementExpenseInput[];
  invoices: StatementInvoiceInput[];
}): UnitYearStatement {
  const ledgerRows = buildLedgerRows(
    input.year,
    input.expenses,
    [{ id: input.unitId, label: input.unitLabel }],
    input.invoices,
  );
  return {
    buildingName: input.buildingName,
    unitLabel: input.unitLabel,
    ...(input.ownerName ? { ownerName: input.ownerName } : {}),
    year: input.year,
    rows: ledgerRows.map((row) => ({
      periodYearMonth: row.periodYearMonth,
      description: row.description,
      invoicedCents: row.invoicedCents,
      paidCents: row.paidCents,
    })),
    totals: ledgerTotals(ledgerRows),
  };
}
