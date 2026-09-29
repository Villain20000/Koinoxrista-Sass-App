import type { BankMatchConfidence } from './bank';

/**
 * A PSD2 bank feed linked to one building account (one connection per
 * building per IBAN).
 */
export interface BankConnectionDto {
  id: string;
  buildingId: string;
  institutionName: string;
  iban: string;
  /** `offline` (deterministic fixture feed) | `gocardless` (live PSD2). */
  mode: string;
  lastSyncedAt: string | null;
  createdAt: string;
}

/** Body of `POST /buildings/:buildingId/bank-connections`. */
export interface CreateBankConnectionRequest {
  iban: string;
  institutionName?: string;
}

/** One transaction pulled from a bank feed and stored for a connection. */
export interface ImportedTransactionDto {
  id: string;
  connectionId: string;
  externalId: string;
  bookedAt: string;
  amountCents: number;
  remittanceInfo: string | null;
}

/**
 * An imported transaction annotated with the confidence of the pairing
 * suggested against the building's unsettled payments (`null` = no match).
 */
export interface ImportedTransactionSuggestionDto extends ImportedTransactionDto {
  suggestionConfidence: BankMatchConfidence | null;
}

/** Result of an idempotent `POST /bank-connections/:id/sync` invocation. */
export interface SyncResultDto {
  /** Transactions newly stored by this sync (re-syncs dedupe on externalId). */
  newCount: number;
  /** Suggested pairings by match confidence. */
  high: number;
  medium: number;
  low: number;
}
