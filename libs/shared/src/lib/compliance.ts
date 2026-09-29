/** Kinds of compliance items tracked per building (mirrors Prisma ComplianceKind). */
export type ComplianceKind =
  | 'INSURANCE'
  | 'ELEVATOR_CERTIFICATE'
  | 'FIRE_SAFETY'
  | 'OTHER';

/**
 * A building insurance policy or mandatory certificate with expiry tracking
 * (Ν.4756/2020 requires building insurance). `expired`/`daysLeft` are computed
 * server-side; dates are ISO strings.
 */
export interface ComplianceItemDto {
  id: string;
  buildingId: string;
  kind: ComplianceKind;
  title: string;
  providerName?: string | null;
  policyNumber?: string | null;
  premiumCents?: number | null;
  startsOn: string;
  endsOn: string;
  notes?: string | null;
  /** True when endsOn is before today (UTC calendar days). */
  expired: boolean;
  /** Whole days until endsOn; negative when already expired. */
  daysLeft: number;
  createdAt?: string;
}

export interface CreateComplianceDto {
  kind: ComplianceKind;
  title: string;
  providerName?: string;
  policyNumber?: string;
  premiumCents?: number;
  startsOn: string;
  endsOn: string;
  notes?: string;
}

export interface UpdateComplianceDto {
  kind?: ComplianceKind;
  title?: string;
  providerName?: string;
  policyNumber?: string;
  premiumCents?: number;
  startsOn?: string;
  endsOn?: string;
  notes?: string;
}

/** Body of `POST /buildings/:buildingId/compliance/check-expiries`. */
export interface CheckExpiriesResultDto {
  notified: number;
  skipped: number;
}
