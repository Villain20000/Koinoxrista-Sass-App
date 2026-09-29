/**
 * Forward-only partner-lead pipeline, pure and dependency-free.
 *
 * NEW → CONTACTED → QUOTED → { WON | LOST }; WON and LOST are terminal.
 */

/** Pipeline statuses of a PartnerLead (mirrors the `status` column values). */
export type LeadStatus = 'NEW' | 'CONTACTED' | 'QUOTED' | 'WON' | 'LOST';

/** Canonical stage order; index order is the forward direction. */
export const PIPELINE_ORDER: readonly LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'QUOTED',
  'WON',
  'LOST',
];

/** String values accepted by the status endpoint / query filter. */
export const LEAD_STATUS_VALUES: readonly string[] = PIPELINE_ORDER;

export function isLeadStatus(value: string): value is LeadStatus {
  return (PIPELINE_ORDER as readonly string[]).includes(value);
}

/** Legal forward-only moves. WON/LOST have no exits. */
const ALLOWED_NEXT: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ['CONTACTED'],
  CONTACTED: ['QUOTED'],
  QUOTED: ['WON', 'LOST'],
  WON: [],
  LOST: [],
};

/** Client-mirror helper: statuses reachable from `status` in one move. */
export function nextStatuses(status: LeadStatus): readonly LeadStatus[] {
  return ALLOWED_NEXT[status] ?? [];
}

export function canTransition(from: string, to: string): boolean {
  if (!isLeadStatus(from) || !isLeadStatus(to)) return false;
  return nextStatuses(from).includes(to);
}

/** Typed outcome of a status-change validation. */
export type StatusChangeResult =
  | { ok: true }
  | { ok: false; reason: 'UNKNOWN_STATUS'; message: string }
  | { ok: false; reason: 'ILLEGAL_TRANSITION'; message: string }
  | { ok: false; reason: 'WON_REQUIRES_AMOUNT'; message: string };

/**
 * Validates a pipeline move. `actualCommissionCents` must be present and ≥ 0
 * when moving to WON (realized revenue share).
 */
export function validateStatusChange(
  from: string,
  to: string,
  actualCommissionCents?: number,
): StatusChangeResult {
  if (!isLeadStatus(from) || !isLeadStatus(to)) {
    return {
      ok: false,
      reason: 'UNKNOWN_STATUS',
      message: `Unknown lead status (${from} → ${to})`,
    };
  }
  if (!canTransition(from, to)) {
    return {
      ok: false,
      reason: 'ILLEGAL_TRANSITION',
      message: `Illegal transition ${from} → ${to} (pipeline is forward-only)`,
    };
  }
  if (
    to === 'WON' &&
    (actualCommissionCents === undefined ||
      !Number.isInteger(actualCommissionCents) ||
      actualCommissionCents < 0)
  ) {
    return {
      ok: false,
      reason: 'WON_REQUIRES_AMOUNT',
      message: 'actualCommissionCents ≥ 0 is required to mark a lead as WON',
    };
  }
  return { ok: true };
}
