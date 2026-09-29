import type { VoteTally, VoteChoice } from './votes';

/** Occupant type discriminator — OWNER = ιδιοκτήτης, TENANT = ενοικιαστής */
export type OccupantType = 'OWNER' | 'TENANT';

/** Voting category — determines which rule applies */
export type EligibilityCategory = 'GENERAL' | 'STRUCTURAL' | 'FINANCIAL';

/** One occupancy row as returned by the tenancy API */
export interface OccupancyDto {
  id: string;
  unitId: string;
  userId: string;
  shareMillimes: number;
  occupantType: OccupantType;
  votingEligible: boolean;
  residentRole?: string | null;
  periodStart?: string | null;
  user?: { firstName: string; lastName: string; email: string } | null;
}

/** Payload for PUT /buildings/:buildingId/occupancy/:unitId */
export interface SetOccupancyDto {
  userId: string;
  occupantType: OccupantType;
  votingEligible?: boolean;
  residentRole?: string | null;
  shareMillimes?: number;
  periodStart?: string;
}

/** Voting eligibility rule — per building + category */
export interface VotingEligibilityRuleDto {
  id: string;
  buildingId: string;
  category: EligibilityCategory;
  allowedTypes: OccupantType[];
  requiresMillimes: boolean;
  createdAt: string;
}

/** Payload for PUT /buildings/:buildingId/eligibility-rules */
export interface UpsertEligibilityRuleDto {
  category: EligibilityCategory;
  allowedTypes: OccupantType[];
  requiresMillimes?: boolean;
}

/** Response for GET /buildings/:buildingId/votes/:voteId/eligibility/:unitId */
export interface EligibilityCheckDto {
  eligible: boolean;
  reason: string;
  occupantType?: OccupantType;
  votingEligible?: boolean;
  ruleCategory?: string;
  allowedTypes?: OccupantType[];
  requiresMillimes?: boolean;
}

/** Badge helper for occupant type */
export function occupantBadge(occupantType: OccupantType): {
  label: string;
  cls: string;
} {
  return occupantType === 'OWNER'
    ? { label: 'Ιδιοκτήτης', cls: 'bg-blue-100 text-blue-800' }
    : { label: 'Ενοικιαστής', cls: 'bg-amber-100 text-amber-800' };
}

/** Greek label for eligibility category */
export function eligibilityCategoryLabel(category: EligibilityCategory): string {
  switch (category) {
    case 'GENERAL':
      return 'Γενική';
    case 'STRUCTURAL':
      return 'Στατική / Δομική';
    case 'FINANCIAL':
      return 'Οικονομική';
  }
}

/** Allowed types label */
export function allowedTypesLabel(types: OccupantType[]): string {
  if (types.length === 2) return 'Ιδιοκτήτες + Ενοικιαστές';
  return types.includes('OWNER') ? 'Μόνο ιδιοκτήτες' : 'Μόνο ενοικιαστές';
}

/**
 * Pure helper to describe eligibility in Greek for UI.
 * mirrors TenancyService.checkCanVote reason codes.
 */
export function eligibilityReasonLabel(reason: string): string {
  switch (reason) {
    case 'ELIGIBLE':
      return 'Δικαίωμα ψήφου';
    case 'OCCUPANT_TYPE_NOT_ALLOWED':
      return 'Ο τύπος ενοίκου δεν επιτρέπεται';
    case 'NOT_VOTING_ELIGIBLE':
      return 'Χωρίς δικαίωμα ψήφου (απενεργοποιημένο)';
    case 'NO_OCCUPANT':
      return 'Χωρίς ένοικο';
    default:
      return reason;
  }
}

/** Re-export tally types for convenience */
export type { VoteTally, VoteChoice };
