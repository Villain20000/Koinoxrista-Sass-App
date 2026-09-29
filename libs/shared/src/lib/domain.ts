/** Role / strategy / status unions mirroring the Prisma enums. */
export type Role =
  | 'ADMIN'
  | 'RESIDENT'
  | 'PROVIDER'
  | 'ACCOUNTANT'
  | 'PLATFORM_ADMIN'
  | 'BUILDING_OWNER';

export type AllocationStrategy =
  | 'MILIMES'
  | 'UNITS'
  | 'CUSTOM'
  | 'RADIATORS'
  | 'ELEVATOR_FLOORS'
  | 'SQUARE_METERS'
  | 'SHARE_FRACTION'
  | 'HEADCOUNT';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export const TOTAL_MILLIMES = 1000;

export interface Unit {
  id: string;
  buildingId: string;
  label: string;
  floor?: number | null;
  millimes: number;
  radiatorCount: number;
  /** P0-3: usable area in m² (SQUARE_METERS strategy, EU/NA). */
  squareMeters?: number | null;
  /** P0-3: ownership share as integer ‰ of 1000 (SHARE_FRACTION, NA HOA). */
  shareFraction?: number | null;
}

export interface CreateUnitDto {
  label: string;
  floor?: number;
  millimes: number;
  radiatorCount?: number;
  squareMeters?: number;
  shareFraction?: number;
}

export interface Ownership {
  id: string;
  unitId: string;
  userId: string;
  shareMillimes: number;
  periodStart?: string | null;
}

export interface CreateOwnershipDto {
  userId: string;
  shareMillimes: number;
  periodStart?: string;
}

export interface ExpenseCategory {
  id: string;
  buildingId: string;
  name: string;
  strategy: AllocationStrategy;
}

export interface CreateExpenseCategoryDto {
  name: string;
  strategy: AllocationStrategy;
}

export interface Share {
  id: string;
  expenseId: string;
  unitId: string;
  amountCents: number;
}

export interface Expense {
  id: string;
  buildingId: string;
  categoryId: string;
  description: string;
  totalCents: number;
  periodYearMonth: string;
  createdById: string;
  createdAt?: string;
  shares?: Share[];
}

export interface CreateExpenseDto {
  categoryId: string;
  description: string;
  totalCents: number;
  periodYearMonth: string;
}

export interface Invoice {
  id: string;
  buildingId: string;
  unitId: string;
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
  status: PaymentStatus;
}

export interface RunInvoicesDto {
  periodYearMonth: string;
}
