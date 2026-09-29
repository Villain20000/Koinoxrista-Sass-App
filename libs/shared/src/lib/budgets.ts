/** A planned annual budget line for one building/year (money in integer cents). */
export interface BudgetLineDto {
  id: string;
  buildingId: string;
  year: number;
  categoryId?: string | null;
  name: string;
  plannedCents: number;
  createdAt?: string;
}

export interface CreateBudgetLineDto {
  year: number;
  name: string;
  plannedCents: number;
  categoryId?: string;
}

export interface UpdateBudgetLineDto {
  year?: number;
  name?: string;
  plannedCents?: number;
  categoryId?: string;
}

/**
 * One compare row PER CATEGORY: `plannedCents` aggregates every budget line of
 * that category and `actualCents` sums the year's expenses for it. Budget lines
 * without a category roll into a single row keyed by `categoryId: null`. Rows
 * are aggregated, so `name` is only meaningful when a row is backed by a
 * single budget line.
 */
export interface BudgetCompareRowDto {
  categoryId: string | null;
  categoryName: string;
  name?: string | null;
  plannedCents: number;
  actualCents: number;
}

export interface BudgetCompareResponseDto {
  year: number;
  lines: BudgetCompareRowDto[];
  totals: {
    plannedCents: number;
    actualCents: number;
  };
}
