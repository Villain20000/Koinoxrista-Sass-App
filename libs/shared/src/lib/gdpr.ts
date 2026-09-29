import type { Role } from './domain';

/** GDPR data-subject rights (Phase 5): personal-data export & erasure. */

/** Domain used for anonymized accounts (RFC 2606 invalid TLD). */
export const ANONYMIZED_EMAIL_DOMAIN = 'anonymized.invalid';

/** Replacement given name / surname after erasure. */
export const ANONYMIZED_NAME = 'Ανώνυμος';

/** Literal the user must confirm to trigger account erasure. */
export const DELETE_CONFIRMATION = 'DELETE';

export interface DeleteMeDto {
  confirm: string;
}

export interface GdprExportDto {
  exportedAt: string;
  profile: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    role: Role;
    createdAt: string;
  };
  ownerships: {
    unitLabel: string;
    shareMillimes: number;
    periodStart: string | null;
  }[];
  invoicesOfOwnedUnits: {
    id: string;
    periodYearMonth: string;
    totalCents: number;
    paidCents: number;
    status: string;
    payments: {
      method: string;
      amountCents: number;
      status: string;
      pspRef: string | null;
      createdAt: string;
    }[];
  }[];
  ballots: { voteTopic: string; choice: string }[];
  bids: {
    id: string;
    jobId: string;
    amountCents: number;
    message: string | null;
    status: string;
    ratingStars: number | null;
  }[];
  workLogs: { id: string; jobId: string; note: string; loggedAt: string }[];
  providerProfile: {
    trade: string;
    certs: string[];
    rating: number | null;
  } | null;
  documents: {
    fileName: string;
    type: string;
    sizeBytes: number;
    createdAt: string;
  }[];
}
