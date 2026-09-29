/** Legal Escalation Pack: Εξώδικο → Διαταγή Πληρωμής */

export const LEGAL_STAGES = ['NOTICE', 'LAWYER', 'COURT', 'CLOSED'] as const;
export type LegalStage = (typeof LEGAL_STAGES)[number];

export const LEGAL_STATUSES = ['OPEN', 'SENT', 'ACKNOWLEDGED', 'CLOSED'] as const;
export type LegalStatus = (typeof LEGAL_STATUSES)[number];

export const LEGAL_EVENT_TYPES = ['CREATED', 'NOTICE_SENT', 'ESCALATED', 'CLOSED', 'NOTE'] as const;
export type LegalEventType = (typeof LEGAL_EVENT_TYPES)[number];

/** One legal case grouping unpaid invoices of a unit for escalation. */
export interface LegalCaseDto {
  id: string;
  buildingId: string;
  unitId: string;
  title: string;
  stage: LegalStage | string;
  status: LegalStatus | string;
  totalCents: number;
  invoiceIds: string[];
  lawyerName?: string | null;
  lawyerEmail?: string | null;
  notes?: string | null;
  lastSentAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Denormalized for listing */
  unitLabel?: string | null;
  buildingName?: string | null;
  /** Full event timeline, included by detail endpoint */
  events?: LegalEventDto[];
}

/** Timeline event of a legal case */
export interface LegalEventDto {
  id: string;
  caseId: string;
  buildingId: string;
  type: LegalEventType | string;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}

/** Body of POST /buildings/:buildingId/legal/cases */
export interface CreateLegalCaseDto {
  unitId: string;
  invoiceIds: string[];
  title?: string;
  lawyerName?: string;
  lawyerEmail?: string;
  notes?: string;
}

/** Body of POST .../legal/cases/:id/advance */
export interface AdvanceLegalCaseDto {
  nextStage?: string;
  stage?: string;
}

/** Body of POST .../legal/cases/:id/note */
export interface AddLegalNoteDto {
  note: string;
}

/** Body of POST .../legal/cases/:id/close */
export interface CloseLegalCaseDto {
  reason?: string;
}

/** GET /buildings/:buildingId/legal/stats */
export interface LegalStatsDto {
  totalCases: number;
  totalOutstandingCents: number;
  byStage: { stage: string; count: number }[];
  byStatus: { status: string; count: number }[];
}

export function isLegalStage(value: string): value is LegalStage {
  return (LEGAL_STAGES as readonly string[]).includes(value);
}

export function isLegalStatus(value: string): value is LegalStatus {
  return (LEGAL_STATUSES as readonly string[]).includes(value);
}

/** Forward-only stage machine: NOTICE → LAWYER → COURT → CLOSED */
export const LEGAL_STAGE_ORDER: Record<LegalStage, number> = {
  NOTICE: 0,
  LAWYER: 1,
  COURT: 2,
  CLOSED: 3,
};

export function canAdvanceStage(from: string, to: string): boolean {
  if (!isLegalStage(from) || !isLegalStage(to)) return false;
  return LEGAL_STAGE_ORDER[to as LegalStage] === LEGAL_STAGE_ORDER[from as LegalStage] + 1;
}

export function nextLegalStage(stage: LegalStage): LegalStage | null {
  const order = LEGAL_STAGE_ORDER[stage];
  if (order === undefined || order >= LEGAL_STAGES.length - 1) return null;
  return LEGAL_STAGES[order + 1];
}

export function legalStageLabel(stage: string): string {
  switch (stage) {
    case 'NOTICE':
      return 'Εξώδικο';
    case 'LAWYER':
      return 'Δικηγόρος';
    case 'COURT':
      return 'Δικαστήριο';
    case 'CLOSED':
      return 'Κλειστή';
    default:
      return stage;
  }
}

export function legalStatusLabel(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'Ανοικτή';
    case 'SENT':
      return 'Απεστάλη';
    case 'ACKNOWLEDGED':
      return 'Έλαβε γνώση';
    case 'CLOSED':
      return 'Κλειστή';
    default:
      return status;
  }
}

export function legalStageBadgeClass(stage: string): string {
  switch (stage) {
    case 'NOTICE':
      return 'bg-amber-100 text-amber-800';
    case 'LAWYER':
      return 'bg-blue-100 text-blue-800';
    case 'COURT':
      return 'bg-purple-100 text-purple-800';
    case 'CLOSED':
      return 'bg-slate-200 text-slate-600';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

export function legalStatusBadgeClass(status: string): string {
  switch (status) {
    case 'OPEN':
      return 'bg-blue-100 text-blue-800';
    case 'SENT':
      return 'bg-amber-100 text-amber-800';
    case 'ACKNOWLEDGED':
      return 'bg-green-100 text-green-700';
    case 'CLOSED':
      return 'bg-slate-200 text-slate-600';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}
