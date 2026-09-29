import type { VoteThresholdType } from '@org/shared';

import { quorumOf } from './quorum';

describe('quorumOf', () => {
  it('meets SIMPLE_MAJORITY quorum at exactly half the millimes', () => {
    expect(quorumOf(1000, 500, 'SIMPLE_MAJORITY')).toEqual({
      quorumMet: true,
      presentPermille: 500,
    });
  });

  it('drops below quorum under half participation', () => {
    const result = quorumOf(1000, 499, 'SIMPLE_MAJORITY');
    expect(result.quorumMet).toBe(false);
    expect(result.presentPermille).toBe(499);
  });

  it('requires strictly more than half for MILLIMES_MAJORITY', () => {
    expect(quorumOf(1000, 500, 'MILLIMES_MAJORITY').quorumMet).toBe(false);
    expect(quorumOf(1000, 501, 'MILLIMES_MAJORITY').quorumMet).toBe(true);
  });

  it('floors the permille share', () => {
    // 1/3 of the building → 333‰, not 334‰.
    expect(quorumOf(3000, 1000, 'SIMPLE_MAJORITY').presentPermille).toBe(333);
    expect(quorumOf(3, 1, 'SIMPLE_MAJORITY').presentPermille).toBe(333);
  });

  it('reports full attendance as 1000‰', () => {
    expect(quorumOf(750, 750, 'SIMPLE_MAJORITY').presentPermille).toBe(1000);
  });

  it('clamps overcounted presence to the total', () => {
    const result = quorumOf(500, 900, 'SIMPLE_MAJORITY');
    expect(result.presentPermille).toBe(1000);
    expect(result.quorumMet).toBe(true);
  });

  it('treats negative input as zero presence', () => {
    expect(quorumOf(1000, -5, 'SIMPLE_MAJORITY')).toEqual({
      quorumMet: false,
      presentPermille: 0,
    });
  });

  it('resolves the degenerate zero-millime building to quorum met', () => {
    expect(quorumOf(0, 0, 'SIMPLE_MAJORITY').quorumMet).toBe(true);
    expect(quorumOf(0, 0, 'MILLIMES_MAJORITY').quorumMet).toBe(true);
    expect(quorumOf(0, 0, 'SIMPLE_MAJORITY').presentPermille).toBe(0);
  });

  it('accepts both modeled threshold types without throwing', () => {
    const types: VoteThresholdType[] = ['SIMPLE_MAJORITY', 'MILLIMES_MAJORITY'];
    for (const type of types) {
      expect(() => quorumOf(10, 5, type)).not.toThrow();
    }
  });
});
