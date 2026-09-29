/** How a late fee accrues: flat cents per day, or basis points of the outstanding balance per day. */
export type LateFeeMode = 'FLAT' | 'PERCENT';

/** Per-building configuration for Ρόπα late-payment surcharges. */
export interface LateFeeSettingsDto {
  buildingId: string;
  /** Days past the due date before a fee starts accruing. */
  graceDays: number;
  mode: LateFeeMode;
  /** FLAT mode: surcharge cents applied per late day. */
  dailyFlatCents: number;
  /** PERCENT mode: basis points of the outstanding balance per late day (e.g. 50 = 0.5%). */
  dailyBps: number;
  /** Optional upper bound for a single charge, in cents. */
  capCents: number | null;
  /** ISO datetime of the last settings change. */
  updatedAt?: string;
}

/** Partial settings update; omitted fields keep their current value. */
export interface UpdateLateFeeSettingsDto {
  graceDays?: number;
  mode?: LateFeeMode;
  dailyFlatCents?: number;
  dailyBps?: number;
  /** `null` removes an existing cap. */
  capCents?: number | null;
}

/** Request body for running a late-fee sweep. */
export interface RunLateFeesDto {
  /** Restrict the sweep to one invoice month (`YYYY-MM`). Omitted = all months. */
  month?: string;
}

/** Outcome of a late-fee run (idempotent per unit+invoiceMonth). */
export interface LateFeeRunResultDto {
  /** Number of newly created charges. */
  charged: number;
  /** Sum of the newly created charges, in cents. */
  totalCents: number;
}

/** One applied late-payment surcharge on a unit's invoice month. */
export interface LateFeeChargeDto {
  id: string;
  buildingId: string;
  unitId: string;
  invoiceId: string;
  /** Invoice period the charge belongs to (`YYYY-MM`). */
  month: string;
  /** Chargeable late days used in the computation (overdue days minus grace). */
  daysLate: number;
  amountCents: number;
  /** ISO datetime when an admin waived the charge, if waived. */
  waivedAt: string | null;
  /** Denormalized label resolved by the API for listing views. */
  unitLabel?: string | null;
  createdAt?: string;
}
