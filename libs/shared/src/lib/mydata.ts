export type MyDataStatus = 'PENDING' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';

/** Body of `POST /mydata/generate`. */
export interface GenerateMyDataDto {
  /** Billing period in `YYYY-MM` form. */
  periodYearMonth: string;
}

/** A koinoxrista invoice as registered with ΑΑΔΕ myDATA. */
export interface MyDataInvoiceDto {
  id: string;
  invoiceId: string;
  buildingId: string;
  /** Μοναδικός Αριθμός Καταχώρησης — AADE's unique registration number. */
  mark: string;
  series: string;
  seqNo: number;
  issueDate: string;
  paymentMethodCode: string;
  classificationCategory: string;
  classificationType: string;
  netAmountCents: number;
  vatAmountCents: number;
  status: MyDataStatus;
}
