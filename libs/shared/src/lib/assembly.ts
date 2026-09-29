import type { VoteChoice, VoteOutcome, VoteThresholdType } from './votes';

/** One discussion item of an assembly's live agenda (position = order, 1-based). */
export interface AgendaItemDto {
  id: string;
  voteId: string;
  position: number;
  title: string;
  body?: string | null;
}

export interface CreateAgendaItemDto {
  title: string;
  body?: string;
}

/** PATCH semantics: only provided fields change; `position` reorders. */
export interface UpdateAgendaItemDto {
  title?: string;
  body?: string;
  position?: number;
}

/**
 * One unit's assembly attendance row, enriched for the admin grid:
 * `present` covers physical check-in AND representation by proxy, while
 * `ballotChoice` is the unit's remote ballot (if any) used to verify that
 * remote voters are also marked present.
 */
export interface AttendanceDto {
  id: string | null;
  voteId: string;
  unitId: string;
  unitLabel: string;
  millimes: number;
  present: boolean;
  proxyUnitId?: string | null;
  checkedInAt?: string | null;
  ballotChoice?: VoteChoice | null;
}

export interface AttendanceToggleDto {
  unitId: string;
  present: boolean;
  proxyUnitId?: string | null;
}

/** Quorum snapshot of an assembly (present millimes ‰ vs building total). */
export interface AttendanceStatsDto {
  unitsTotal: number;
  unitsPresent: number;
  totalMillimes: number;
  millimesPresent: number;
  /** floor(present / total * 1000); 0 for a zero-millime building. */
  presentPermille: number;
  quorumMet: boolean;
}

/** The decision recorded in the minutes for one agenda item. */
export interface PraktikoDecisionDto {
  /** Null when the assembly has no agenda items (decision keyed to the vote topic). */
  agendaItemId: string | null;
  title: string;
  outcome: VoteOutcome;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  yesMillimes: number;
  noMillimes: number;
}

export interface PraktikoAgendaEntryDto {
  id: string;
  position: number;
  title: string;
  body?: string | null;
}

export interface PraktikoBuildingDto {
  id: string;
  name: string;
  address: string;
  city: string;
}

export interface PraktikoVoteDto {
  id: string;
  topic: string;
  description?: string | null;
  thresholdType: VoteThresholdType;
  opensAt: string;
  closesAt: string;
  closed: boolean;
}

/** Auto-generated πρακτικό (assembly minutes) for a vote. */
export interface PraktikoDto {
  building: PraktikoBuildingDto;
  vote: PraktikoVoteDto;
  agenda: PraktikoAgendaEntryDto[];
  decisions: PraktikoDecisionDto[];
  attendance: AttendanceStatsDto;
  generatedAt: string;
}
