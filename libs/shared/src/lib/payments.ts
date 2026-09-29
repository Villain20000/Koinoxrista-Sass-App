export type PaymentOrderStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

/** A PSP checkout session for an invoice (Viva Smart Checkout order). */
export interface PaymentOrder {
  id: string;
  invoiceId: string;
  orderCode: string;
  amountCents: number;
  status: PaymentOrderStatus;
  checkoutUrl: string;
  createdAt?: string;
}

export interface CreatePaymentOrderResponse {
  order: PaymentOrder;
}

/** One row of the admin arrears aging report. */
export interface ArrearsRow {
  unitId: string;
  unitLabel: string;
  ownerNames: string[];
  outstandingCents: number;
  /** Outstanding split into aging buckets by oldest unpaid invoice age. */
  bucketCurrentCents: number;
  bucket30Cents: number;
  bucket60Cents: number;
  bucket90PlusCents: number;
  oldestUnpaidPeriod: string | null;
}

export interface ArrearsReport {
  buildingId: string;
  generatedAt: string;
  totalOutstandingCents: number;
  rows: ArrearsRow[];
}

export type ReminderChannel = 'EMAIL';
