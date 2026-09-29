import type { VoteChoice, VoteTally } from '@org/shared';

import { tallyVote, TallyBallot } from './tally-vote';

const ballot = (choice: VoteChoice, millimes: number): TallyBallot => ({
  choice,
  millimes,
});

describe('tallyVote', () => {
  it('passes a SIMPLE_MAJORITY vote when yes beats no', () => {
    const tally = tallyVote(
      'SIMPLE_MAJORITY',
      [ballot('YES', 100), ballot('YES', 100), ballot('NO', 300)],
      3,
      500,
    );

    expect(tally).toEqual<VoteTally>({
      yesCount: 2,
      noCount: 1,
      abstainCount: 0,
      yesMillimes: 200,
      noMillimes: 300,
      totalMillimes: 500,
      quorumMet: true,
      outcome: 'PASSED',
    });
  });

  it('treats HEADCOUNT like SIMPLE_MAJORITY with per-unit equal weights', () => {
    const tally = tallyVote(
      'HEADCOUNT',
      [ballot('YES', 1), ballot('YES', 1), ballot('NO', 1)],
      3,
      3,
    );

    expect(tally.yesCount).toBe(2);
    expect(tally.noCount).toBe(1);
    expect(tally.totalMillimes).toBe(3);
    expect(tally.quorumMet).toBe(true);
    expect(tally.outcome).toBe('PASSED');
  });

  it('rejects a HEADCOUNT tie on unit counts', () => {
    const tally = tallyVote(
      'HEADCOUNT',
      [ballot('YES', 1), ballot('NO', 1)],
      2,
      2,
    );

    expect(tally.outcome).toBe('REJECTED');
  });

  it('rejects a SIMPLE_MAJORITY tie', () => {
    const tally = tallyVote(
      'SIMPLE_MAJORITY',
      [ballot('YES', 250), ballot('NO', 250)],
      2,
      500,
    );

    expect(tally.yesCount).toBe(1);
    expect(tally.noCount).toBe(1);
    expect(tally.outcome).toBe('REJECTED');
  });

  it('rejects a SIMPLE_MAJORITY vote decided only by abstentions', () => {
    const tally = tallyVote(
      'SIMPLE_MAJORITY',
      [ballot('ABSTAIN', 400), ballot('ABSTAIN', 100)],
      2,
      500,
    );

    expect(tally.abstainCount).toBe(2);
    expect(tally.quorumMet).toBe(true);
    expect(tally.outcome).toBe('REJECTED');
  });

  it('never lets abstentions flip a SIMPLE_MAJORITY result', () => {
    const tally = tallyVote(
      'SIMPLE_MAJORITY',
      [
        ballot('YES', 10),
        ballot('YES', 10),
        ballot('NO', 10),
        ballot('NO', 10),
        ballot('ABSTAIN', 300),
      ],
      5,
      340,
    );

    expect(tally.yesCount).toBe(2);
    expect(tally.noCount).toBe(2);
    expect(tally.abstainCount).toBe(1);
    expect(tally.outcome).toBe('REJECTED');
  });

  it('rejects empty ballots outright', () => {
    const tally = tallyVote('SIMPLE_MAJORITY', [], 4, 1000);

    expect(tally).toEqual<VoteTally>({
      yesCount: 0,
      noCount: 0,
      abstainCount: 0,
      yesMillimes: 0,
      noMillimes: 0,
      totalMillimes: 1000,
      quorumMet: false,
      outcome: 'REJECTED',
    });
  });

  it('passes a MILLIMES_MAJORITY vote only above half of total millimes', () => {
    const passing = tallyVote(
      'MILLIMES_MAJORITY',
      [ballot('YES', 501), ballot('NO', 499)],
      2,
      1000,
    );
    expect(passing.outcome).toBe('PASSED');
  });

  it('rejects a MILLIMES_MAJORITY vote at exactly half', () => {
    const tally = tallyVote(
      'MILLIMES_MAJORITY',
      [ballot('YES', 500), ballot('NO', 500)],
      2,
      1000,
    );

    expect(tally.yesMillimes).toBe(500);
    expect(tally.quorumMet).toBe(true);
    expect(tally.outcome).toBe('REJECTED');
  });

  it('rejects a MILLIMES_MAJORITY vote won by unit count but lost on millimes', () => {
    const tally = tallyVote(
      'MILLIMES_MAJORITY',
      [
        ballot('YES', 10),
        ballot('YES', 10),
        ballot('YES', 10),
        ballot('NO', 485),
        ballot('NO', 485),
      ],
      5,
      1000,
    );

    expect(tally.yesCount).toBe(3);
    expect(tally.noCount).toBe(2);
    expect(tally.yesMillimes).toBe(30);
    expect(tally.noMillimes).toBe(970);
    expect(tally.outcome).toBe('REJECTED');
  });

  it('rejects empty ballots under MILLIMES_MAJORITY too', () => {
    const tally = tallyVote('MILLIMES_MAJORITY', [], 3, 600);

    expect(tally.outcome).toBe('REJECTED');
    expect(tally.quorumMet).toBe(false);
  });

  it('marks quorum met when participation reaches exactly half the millimes', () => {
    const tally = tallyVote(
      'SIMPLE_MAJORITY',
      [ballot('YES', 500)],
      2,
      1000,
    );

    expect(tally.quorumMet).toBe(true);
  });

  it('marks quorum unmet below half participation', () => {
    const tally = tallyVote(
      'SIMPLE_MAJORITY',
      [ballot('YES', 499)],
      2,
      1000,
    );

    expect(tally.quorumMet).toBe(false);
  });

  it('counts abstention millimes towards quorum participation', () => {
    const tally = tallyVote(
      'SIMPLE_MAJORITY',
      [ballot('ABSTAIN', 600), ballot('NO', 400)],
      2,
      1000,
    );

    expect(tally.quorumMet).toBe(true);
  });

  it('aggregates counts and millimes across many ballots', () => {
    const ballots = [
      ballot('YES', 100),
      ballot('YES', 150),
      ballot('NO', 50),
      ballot('ABSTAIN', 200),
    ];
    const tally = tallyVote('MILLIMES_MAJORITY', ballots, 4, 500);

    expect(tally.yesCount).toBe(2);
    expect(tally.noCount).toBe(1);
    expect(tally.abstainCount).toBe(1);
    expect(tally.yesMillimes).toBe(250);
    expect(tally.noMillimes).toBe(50);
    expect(tally.totalMillimes).toBe(500);
    expect(tally.quorumMet).toBe(true);
  });

  it('handles the degenerate zero-millime building without quorum ambiguity', () => {
    const tally = tallyVote('SIMPLE_MAJORITY', [], 0, 0);

    expect(tally.totalMillimes).toBe(0);
    expect(tally.quorumMet).toBe(true);
    expect(tally.outcome).toBe('REJECTED');
  });

  it('never returns PENDING; the service overrides while a vote is open', () => {
    const outcomes: VoteTally['outcome'][] = [
      tallyVote('SIMPLE_MAJORITY', [], 1, 10).outcome,
      tallyVote('SIMPLE_MAJORITY', [ballot('YES', 10)], 1, 10).outcome,
      tallyVote('MILLIMES_MAJORITY', [ballot('NO', 10)], 1, 10).outcome,
    ];

    for (const outcome of outcomes) {
      expect(['PASSED', 'REJECTED']).toContain(outcome);
    }
  });
});
