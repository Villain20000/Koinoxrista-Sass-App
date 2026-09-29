/** How money was paid out to a supplier/technician. */
export type SupplierPaymentMethod = 'BANK' | 'CASH' | 'CHECK' | 'CARD';

/** A payout: money paid OUT to suppliers/technicians for a building. */
export interface SupplierPaymentDto {
  id: string;
  buildingId: string;
  amountCents: number;
  method: SupplierPaymentMethod;
  /** ISO datetime of the payment. */
  paidAt: string;
  jobId?: string | null;
  expenseId?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** Denormalized labels resolved by the API for listing views. */
  jobTitle?: string | null;
  expenseDescription?: string | null;
  createdAt?: string;
}

export interface CreateSupplierPaymentDto {
  /** Positive integer cents. */
  amountCents: number;
  method: SupplierPaymentMethod;
  /** ISO datetime of the payment. */
  paidAt: string;
  jobId?: string;
  expenseId?: string;
  reference?: string;
  notes?: string;
}

export interface UpdateSupplierPaymentDto {
  amountCents?: number;
  method?: SupplierPaymentMethod;
  paidAt?: string;
  jobId?: string | null;
  expenseId?: string | null;
  reference?: string | null;
  notes?: string | null;
}

/** Aggregated payouts of one year. */
export interface PayoutSummaryDto {
  totalCents: number;
  byMethod: { method: SupplierPaymentMethod; totalCents: number }[];
  /** `YYYY-MM` buckets, ascending. */
  byMonth: { month: string; totalCents: number }[];
}

/** PROVIDER view: a payout on a job awarded to the caller. */
export interface MyPayoutDto {
  id: string;
  jobTitle: string;
  amountCents: number;
  method: SupplierPaymentMethod;
  paidAt: string;
  reference?: string | null;
}
