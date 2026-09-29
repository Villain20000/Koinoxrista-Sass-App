import type {
  ApologismosCategoryTotal,
  ApologismosCostRow,
  ApologismosDto,
  ApologismosMonthlyPoint,
  ApologismosUnitBalance,
} from '@org/shared';

/** Expense totals grouped by category, straight from a Prisma `groupBy`. */
export interface ApologismosExpenseGroup {
  categoryId: string;
  _sum: { totalCents: number | null };
}

export interface ApologismosBudgetRow {
  categoryId: string | null;
  categoryName: string;
  plannedCents: number;
}

export interface ApologismosInvoiceRow {
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
}

export interface ApologismosInput {
  buildingId: string;
  buildingName: string;
  year: string;
  generatedAt: Date;
  expenseGroups: ApologismosExpenseGroup[];
  budgetRows: ApologismosBudgetRow[];
  invoices: ApologismosInvoiceRow[];
  unitBalances: ApologismosUnitBalance[];
}

export const APOLOGISMOS_YEAR_REGEX = /^\d{4}$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Ascending `YYYY-01`…`YYYY-12` window (pure). */
function yearPeriods(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
}

/**
 * Pure aggregation behind GET /accountant/buildings/:buildingId/apologismos.
 *
 * - income = what residents were charged (expense totals per category)
 * - costs  = budget plan vs actual supplier expenses per category
 * - monthly = invoiced vs collected per calendar month
 * - unitBalances = year-end closing balances (statements engine, precomputed)
 * - surplus/deficit = collected − actual costs
 */
export function buildApologismos(
  input: ApologismosInput,
): ApologismosDto {
  const chargedByKey = new Map<string | null, number>();
  for (const group of input.expenseGroups) {
    chargedByKey.set(
      group.categoryId,
      (chargedByKey.get(group.categoryId) ?? 0) + (group._sum.totalCents ?? 0),
    );
  }

  const nameByKey = new Map<string | null, string>();
  const plannedByKey = new Map<string | null, number>();
  for (const row of input.budgetRows) {
    nameByKey.set(row.categoryId, row.categoryName);
    plannedByKey.set(
      row.categoryId,
      (plannedByKey.get(row.categoryId) ?? 0) + row.plannedCents,
    );
  }

  const incomeKeys = new Set<string | null>([
    ...chargedByKey.keys(),
    ...plannedByKey.keys(),
  ]);
  const incomeByCategory: ApologismosCategoryTotal[] = [...incomeKeys]
    .filter((key) => key !== null || (chargedByKey.get(null) ?? 0) > 0)
    .map((key) => ({
      categoryId: key ?? null,
      categoryName:
        nameByKey.get(key ?? null) ??
        (key === null
          ? 'Λοιπές (χωρίς κατηγορία)'
          : `Κατηγορία ${String(key).slice(-6)}`),
      chargedCents: chargedByKey.get(key ?? null) ?? 0,
    }))
    .sort((a, b) => b.chargedCents - a.chargedCents);

  const costsByCategory: ApologismosCostRow[] = input.budgetRows.map(
    (row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      plannedCents: row.plannedCents,
      actualCents: chargedByKey.get(row.categoryId ?? null) ?? 0,
    }),
  );

  const periods = yearPeriods(input.year);
  const invoiceSums = new Map<string, { total: number; paid: number }>();
  for (const invoice of input.invoices) {
    if (!periods.includes(invoice.periodYearMonth)) continue;
    const sums = invoiceSums.get(invoice.periodYearMonth) ?? {
      total: 0,
      paid: 0,
    };
    sums.total += invoice.totalCents;
    sums.paid += invoice.paidCents;
    invoiceSums.set(invoice.periodYearMonth, sums);
  }
  const monthly: ApologismosMonthlyPoint[] = periods.map((periodYearMonth) => {
    const sums = invoiceSums.get(periodYearMonth) ?? { total: 0, paid: 0 };
    return {
      periodYearMonth,
      invoicedCents: sums.total,
      collectedCents: sums.paid,
      arrearsCents: Math.max(0, sums.total - sums.paid),
    };
  });

  const totals = {
    chargedCents: incomeByCategory.reduce(
      (sum, row) => sum + row.chargedCents,
      0,
    ),
    plannedCents: costsByCategory.reduce(
      (sum, row) => sum + row.plannedCents,
      0,
    ),
    actualCents: costsByCategory.reduce((sum, row) => sum + row.actualCents, 0),
    invoicedCents: monthly.reduce((sum, point) => sum + point.invoicedCents, 0),
    collectedCents: monthly.reduce(
      (sum, point) => sum + point.collectedCents,
      0,
    ),
    arrearsCents: 0,
    surplusDeficitCents: 0,
  };
  totals.arrearsCents = monthly.reduce(
    (sum, point) => sum + point.arrearsCents,
    0,
  );
  totals.surplusDeficitCents = totals.collectedCents - totals.actualCents;

  return {
    buildingId: input.buildingId,
    buildingName: input.buildingName,
    year: input.year,
    generatedAt: input.generatedAt.toISOString(),
    incomeByCategory,
    costsByCategory,
    monthly,
    unitBalances: [...input.unitBalances].sort((a, b) =>
      a.unitLabel.localeCompare(b.unitLabel, 'el'),
    ),
    totals,
  };
}
