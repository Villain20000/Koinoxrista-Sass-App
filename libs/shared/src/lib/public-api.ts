/** Public read-only REST API (PLAN.md §6 Premium feature). */

export const API_SCOPES = [
  'invoices:read',
  'payments:read',
  'votes:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateApiKeyDto {
  name: string;
  scopes: ApiScope[];
}

/** Includes the raw key — only ever returned once, at creation time. */
export interface CreatedApiKeyDto extends ApiKeyDto {
  key: string;
}

/** Invoice ledger row for `GET /public/v1/invoices`. */
export interface PublicInvoiceDto {
  id: string;
  unitLabel: string;
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  status: string;
}

/** Totals for `GET /public/v1/payments/summary` (invoice-level money). */
export interface PublicPaymentSummaryDto {
  paidCents: number;
  outstandingCents: number;
  countByStatus: Record<string, number>;
}

/** Closed-vote results for `GET /public/v1/votes/results`.
 *  Ballot choices are stored as YES | NO | ABSTAIN; ABSTAIN maps to
 *  whiteCount (λευκό / blank ballot). */
export interface PublicVoteResultDto {
  id: string;
  topic: string;
  thresholdType: string;
  closesAt: string;
  result: string | null;
  tally: {
    yesCount: number;
    noCount: number;
    whiteCount: number;
    totalCount: number;
  };
}
