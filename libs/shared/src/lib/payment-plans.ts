/** Lifecycle of a unit's installment plan for outstanding arrears. */
export type PaymentPlanStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

/** One scheduled installment of a payment plan (τμηματοποίηση οφειλής). */
export interface InstallmentDto {
  id: string;
  planId: string;
  /** 1-based order within the plan; payments settle lowest seq first. */
  seq: number;
  /** ISO date the installment is due. */
  dueDate: string;
  amountCents: number;
  paidCents: number;
  /** ISO datetime of the payment that settled this installment, if fully paid. */
  paidAt: string | null;
}

/** An installment plan splitting one unit's arrears into N dated parts. */
export interface PaymentPlanDto {
  id: string;
  buildingId: string;
  unitId: string;
  totalCents: number;
  installmentCount: number;
  status: PaymentPlanStatus;
  createdAt: string;
  cancelledAt: string | null;
  /** Sum of installment payments recorded so far, in cents. */
  paidCents?: number;
  /** Outstanding plan balance (total − paid), in cents. */
  remainingCents?: number;
  /** Denormalized label resolved by the API for listing views. */
  unitLabel?: string | null;
  /** Full schedule; included by schedule/detail endpoints. */
  installments?: InstallmentDto[];
}

/** Request body for splitting a unit's arrears into installments. */
export interface CreatePaymentPlanDto {
  unitId: string;
  /** Plan total in cents; omitted = the unit's current invoice arrears. */
  totalCents?: number;
  /** Number of installments (2–24). */
  installmentCount: number;
  /** ISO date the first installment is due. */
  firstDueDate: string;
  /** Days between installments (default 30). */
  intervalDays?: number;
}

/** Request body for recording a payment against a plan (allocated oldest-first). */
export interface PlanPaymentDto {
  amountCents: number;
}
