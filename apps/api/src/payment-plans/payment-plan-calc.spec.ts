import { MS_PER_DAY, applyPaymentToPlan, splitIntoInstallments } from './payment-plan-calc';

const FIRST_DUE = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01
const NOW = new Date('2026-08-25T10:00:00.000Z');

function makeInstallment(
  seq: number,
  amountCents: number,
  paidCents = 0,
  paidAt: Date | null = null,
) {
  return {
    id: `inst-${seq}`,
    seq,
    amountCents,
    paidCents,
    paidAt,
    dueDate: new Date(FIRST_DUE.getTime() + (seq - 1) * 30 * MS_PER_DAY),
  };
}

describe('splitIntoInstallments', () => {
  it('splits an evenly divisible total into equal installments', () => {
    const schedule = splitIntoInstallments(30_000, 3, FIRST_DUE, 30);

    expect(schedule.map((i) => i.amountCents)).toEqual([10_000, 10_000, 10_000]);
    expect(schedule.map((i) => i.seq)).toEqual([1, 2, 3]);
  });

  it('sums to exactly the total for every count (property spot-check)', () => {
    for (let n = 2; n <= 24; n += 5) {
      const total = 123_457;
      const schedule = splitIntoInstallments(total, n, FIRST_DUE, 15);
      const sum = schedule.reduce((acc, i) => acc + i.amountCents, 0);
      expect(sum).toBe(total);
      expect(schedule).toHaveLength(n);
      expect(schedule.every((i) => Number.isInteger(i.amountCents))).toBe(true);
    }
  });

  it('distributes the remainder one cent at a time to the earliest installments', () => {
    const schedule = splitIntoInstallments(10_001, 3, FIRST_DUE, 30);

    // base 3333 + remainder 2 → first two installments get +1 cent.
    expect(schedule.map((i) => i.amountCents)).toEqual([3334, 3334, 3333]);
    expect(schedule.reduce((a, i) => a + i.amountCents, 0)).toBe(10_001);
  });

  it('spaces due dates intervalDays apart starting at firstDueDate (UTC-safe)', () => {
    const schedule = splitIntoInstallments(20_000, 4, FIRST_DUE, 45);

    expect(schedule[0].dueDate.getTime()).toBe(FIRST_DUE.getTime());
    expect(schedule.map((i) => i.dueDate.toISOString())).toEqual([
      '2026-09-01T00:00:00.000Z',
      '2026-10-16T00:00:00.000Z',
      '2026-11-30T00:00:00.000Z',
      '2027-01-14T00:00:00.000Z',
    ]);
  });
});

describe('applyPaymentToPlan', () => {
  it('allocates oldest-first across several installments and detects completion', () => {
    const plan = [makeInstallment(1, 5_000), makeInstallment(2, 5_000), makeInstallment(3, 5_000)];

    const result = applyPaymentToPlan(plan, 12_000, NOW);

    expect(result.appliedCents).toBe(12_000);
    expect(result.completed).toBe(false);
    expect(result.allocations).toEqual([
      { installmentId: 'inst-1', seq: 1, appliedCents: 5_000 },
      { installmentId: 'inst-2', seq: 2, appliedCents: 5_000 },
      { installmentId: 'inst-3', seq: 3, appliedCents: 2_000 },
    ]);
    expect(result.installments.map((i) => i.paidCents)).toEqual([5_000, 5_000, 2_000]);
    expect(result.installments.map((i) => i.paidAt)).toEqual([NOW, NOW, null]);
  });

  it('keeps mid-plan installments partially paid and untouched later ones intact', () => {
    const plan = [
      makeInstallment(1, 5_000, 5_000, NOW),
      makeInstallment(2, 5_000),
      makeInstallment(3, 5_000),
    ];

    const result = applyPaymentToPlan(plan, 2_000, NOW);

    expect(result.allocations).toEqual([{ installmentId: 'inst-2', seq: 2, appliedCents: 2_000 }]);
    expect(result.installments[0]).toBe(plan[0]); // settled rows pass through unchanged
    expect(result.installments[1].paidCents).toBe(2_000);
    expect(result.installments[1].paidAt).toBeNull(); // not fully settled yet
    expect(result.installments[2]).toBe(plan[2]);
    expect(result.completed).toBe(false);
  });

  it('tops up a partial installment before moving money to later ones', () => {
    const plan = [makeInstallment(1, 5_000, 3_500), makeInstallment(2, 5_000)];

    const result = applyPaymentToPlan(plan, 4_000, NOW);

    expect(result.allocations).toEqual([
      { installmentId: 'inst-1', seq: 1, appliedCents: 1_500 },
      { installmentId: 'inst-2', seq: 2, appliedCents: 2_500 },
    ]);
    expect(result.installments[0].paidAt).toEqual(NOW); // stamped when it settles
    expect(result.installments[1].paidAt).toBeNull();
  });

  it('marks the plan completed when the payment settles the final balance', () => {
    const plan = [makeInstallment(1, 5_000), makeInstallment(2, 2_500, 1_000)];

    const result = applyPaymentToPlan(plan, 6_500, NOW);

    expect(result.completed).toBe(true);
    expect(result.installments.every((i) => i.paidCents >= i.amountCents)).toBe(true);
  });

  it('ignores excess above the remaining balance without corrupting state', () => {
    const plan = [makeInstallment(1, 5_000, 4_000)];

    const result = applyPaymentToPlan(plan, 99_999, NOW);

    expect(result.appliedCents).toBe(1_000);
    expect(result.completed).toBe(true);
    expect(result.installments[0].paidCents).toBe(5_000);
  });

  it('is independent of input order — lowest seq always wins', () => {
    const shuffled = [makeInstallment(3, 5_000), makeInstallment(1, 5_000), makeInstallment(2, 5_000)];

    const result = applyPaymentToPlan(shuffled, 6_000, NOW);

    expect(result.allocations.map((a) => a.seq)).toEqual([1, 2]);
  });
});
