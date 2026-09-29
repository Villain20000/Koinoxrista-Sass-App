import type { VoteChoice, VoteOutcome, VoteTally } from '@org/shared';

export type TallyThresholdType =
  | 'SIMPLE_MAJORITY'
  | 'MILLIMES_MAJORITY'
  | 'HEADCOUNT';

export interface TallyBallot {
  choice: VoteChoice;
  millimes: number;
}

/**
 * Pure tally computation for a building vote.
 *
 * - Counts ballots by choice and sums millimes per side.
 * - Participation (quorum) includes every cast ballot, abstentions included.
 * - SIMPLE_MAJORITY and HEADCOUNT pass iff yesCount > noCount and at least
 *   one YES/NO ballot was cast (abstentions never decide, ties fail). For
 *   HEADCOUNT the caller passes 1 as every unit's weight and the unit count
 *   as total, so quorum is a pure headcount (per-unit equal weight).
 * - MILLIMES_MAJORITY passes iff yesMillimes is a strict majority of the
 *   building's total millimes.
 *
 * The returned outcome is only PASSED or REJECTED; a live/open vote must be
 * reported as PENDING by the caller (service layer overrides).
 */
export function tallyVote(
  thresholdType: TallyThresholdType,
  ballots: TallyBallot[],
  eligibleUnitsCount: number,
  totalMillimes: number,
): VoteTally {
  let yesCount = 0;
  let noCount = 0;
  let abstainCount = 0;
  let yesMillimes = 0;
  let noMillimes = 0;

  for (const ballot of ballots) {
    switch (ballot.choice) {
      case 'YES':
        yesCount += 1;
        yesMillimes += ballot.millimes;
        break;
      case 'NO':
        noCount += 1;
        noMillimes += ballot.millimes;
        break;
      case 'ABSTAIN':
        abstainCount += 1;
        break;
    }
  }

  const participationMillimes =
    yesMillimes + noMillimes +
    ballots
      .filter((b) => b.choice === 'ABSTAIN')
      .reduce((sum, b) => sum + b.millimes, 0);

  const quorumMet = participationMillimes * 2 >= totalMillimes;

  const outcome: Exclude<VoteOutcome, 'PENDING'> =
    thresholdType === 'MILLIMES_MAJORITY'
      ? yesMillimes * 2 > totalMillimes
        ? 'PASSED'
        : 'REJECTED'
      : yesCount > noCount && yesCount + noCount > 0
        ? 'PASSED'
        : 'REJECTED';

  return {
    yesCount,
    noCount,
    abstainCount,
    yesMillimes,
    noMillimes,
    totalMillimes,
    quorumMet,
    outcome,
  };
}
