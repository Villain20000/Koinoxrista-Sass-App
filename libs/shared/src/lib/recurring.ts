/** Strategies a recurring template may use (subset of AllocationStrategy). */
export type RecurringStrategy = 'MILIMES' | 'UNITS';

/** A recurring expense template: auto-billed into Expense + Shares per period. */
export interface RecurringExpenseDto {
  id: string;
  buildingId: string;
  name: string;
  categoryId?: string | null;
  amountCents: number;
  strategy: RecurringStrategy;
  active: boolean;
  /** Last `YYYY-MM` period materialized; null = never billed yet. */
  lastPeriod: string | null;
  createdAt?: string;
}

export interface CreateRecurringExpenseDto {
  name: string;
  amountCents: number;
  strategy: RecurringStrategy;
  categoryId?: string;
  active?: boolean;
}

export interface UpdateRecurringExpenseDto {
  name?: string;
  amountCents?: number;
  strategy?: RecurringStrategy;
  categoryId?: string;
  active?: boolean;
}

/** Body of `POST /buildings/:buildingId/recurring/generate`. */
export interface GenerateRecurringDto {
  /** Billing period in `YYYY-MM` form. */
  periodYearMonth: string;
}

export interface GenerateRecurringResultDto {
  created: number;
}
