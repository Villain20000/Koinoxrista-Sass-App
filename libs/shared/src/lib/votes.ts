export type VoteThresholdType =
  | 'SIMPLE_MAJORITY'
  | 'MILLIMES_MAJORITY'
  | 'HEADCOUNT';

export type VoteChoice = 'YES' | 'NO' | 'ABSTAIN';

export type VoteOutcome = 'PASSED' | 'REJECTED' | 'PENDING';

export interface Vote {
  id: string;
  buildingId: string;
  topic: string;
  description?: string;
  thresholdType: VoteThresholdType;
  opensAt: string;
  closesAt: string;
  result?: VoteOutcome | null;
}

export interface CreateVoteDto {
  topic: string;
  description?: string;
  thresholdType: VoteThresholdType;
  opensAt?: string;
  closesAt: string;
}

export interface CastBallotDto {
  choice: VoteChoice;
}

export interface BallotView {
  id: string;
  choice: VoteChoice;
  votedAt: string;
}

export interface VoteTally {
  yesCount: number;
  noCount: number;
  abstainCount: number;
  yesMillimes: number;
  noMillimes: number;
  /** Millimes eligible to vote (all units of the building). */
  totalMillimes: number;
  quorumMet: boolean;
  outcome: VoteOutcome;
}
