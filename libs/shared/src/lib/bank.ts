export type BankMatchConfidence = 'high' | 'medium' | 'low';

/** One incoming credit parsed from a bank-statement CSV export. */
export interface ParsedBankRowDto {
  /** Statement date in `YYYY-MM-DD` form. */
  dateIso: string;
  amountCents: number;
  reference: string;
}

/** A PENDING payment of the building, candidate for statement matching. */
export interface PendingPaymentOptionDto {
  paymentId: string;
  amountCents: number;
  invoicePeriodYearMonth: string;
  createdAtIso: string;
  unitLabel: string;
}

/** Suggested pairing of a statement row with a pending payment. */
export interface BankMatchSuggestionDto {
  rowIndex: number;
  paymentId?: string;
  confidence: BankMatchConfidence;
}

/** Body of `POST /buildings/:buildingId/bank-import/preview`. */
export interface BankImportPreviewRequest {
  csv: string;
}

export interface BankImportPreviewResponse {
  rows: ParsedBankRowDto[];
  pending: PendingPaymentOptionDto[];
  suggestions: BankMatchSuggestionDto[];
}

/** One user-confirmed row → payment pairing. */
export interface BankImportApplyMatch {
  rowIndex: number;
  paymentId: string;
}

/** Body of `POST /buildings/:buildingId/bank-import/apply`. */
export interface BankImportApplyRequest {
  csv: string;
  matches: BankImportApplyMatch[];
}

export interface BankImportApplyResponse {
  applied: number;
  skipped: number;
}
