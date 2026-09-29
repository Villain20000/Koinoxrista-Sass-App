import { suggestMatches } from './match-bank-payments';
import { PendingBankPayment } from './match-bank-payments';

const DAY_MS = 86_400_000;

function payment(overrides: Partial<PendingBankPayment> = {}): PendingBankPayment {
  return {
    paymentId: 'pay-1',
    amountCents: 10_000,
    invoicePeriodYearMonth: '2026-07',
    createdAtIso: '2026-08-01T10:00:00.000Z',
    unitLabel: 'Α1',
    ...overrides,
  };
}

function row(
  dateIso: string,
  amountCents: number,
  reference = '',
) {
  return { dateIso, amountCents, reference };
}

describe('suggestMatches', () => {
  it('returns [] when there are no rows or no pending payments', () => {
    expect(suggestMatches([], [payment()])).toEqual([]);
    expect(suggestMatches([row('2026-08-01', 10_000)], [])).toEqual([]);
  });

  it('yields high confidence for equal amount + paymentId in reference + ±5 days', () => {
    const suggestions = suggestMatches(
      [row('2026-08-04', 10_000, 'ΕΞΟΦΛΗΣΗ pay-1 ΔΟΣΗ')],
      [payment()],
    );
    expect(suggestions).toEqual([
      { rowIndex: 0, paymentId: 'pay-1', confidence: 'high' },
    ]);
  });

  it('unit label in the reference also yields high confidence (case/spacing insensitive)', () => {
    const suggestions = suggestMatches(
      [row('2026-07-29', 10_000, 'καταθεση α1 κοινοχρηστα')],
      [payment({ unitLabel: 'Α1' })],
    );
    expect(suggestions).toEqual([
      { rowIndex: 0, paymentId: 'pay-1', confidence: 'high' },
    ]);
  });

  it('yields medium confidence for equal amount within window but no reference hit', () => {
    const suggestions = suggestMatches(
      [row('2026-08-05', 10_000, 'WEB BANKING')],
      [payment()],
    );
    expect(suggestions).toEqual([
      { rowIndex: 0, paymentId: 'pay-1', confidence: 'medium' },
    ]);
  });

  it('falls back to low confidence when only the amount matches', () => {
    const suggestions = suggestMatches(
      [row('2026-09-30', 10_000, 'ΑΓΝΩΣΤΟ')],
      [payment()],
    );
    expect(suggestions).toEqual([
      { rowIndex: 0, paymentId: 'pay-1', confidence: 'low' },
    ]);
  });

  it('ignores rows whose amounts differ from every pending payment', () => {
    expect(
      suggestMatches([row('2026-08-01', 9_999, 'pay-1')], [payment()]),
    ).toEqual([]);
  });

  it('prefers high over medium when a row contests the same payments', () => {
    const nearRow = row('2026-08-02', 10_000);
    const refRow = row('2026-08-03', 10_000, 'ΑΝΑ pay-1 Α1');
    const suggestions = suggestMatches([nearRow, refRow], [payment()]);
    expect(suggestions).toEqual([
      { rowIndex: 1, paymentId: 'pay-1', confidence: 'high' },
    ]);
  });

  it('assigns each payment at most once — second identical row stays unmatched', () => {
    const sameDayRows = [
      row('2026-08-01', 10_000),
      row('2026-08-02', 10_000, 'pay-1'),
    ];
    const suggestions = suggestMatches(sameDayRows, [payment()]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({
      rowIndex: 1,
      paymentId: 'pay-1',
      confidence: 'high',
    });
  });

  it('pairs greedily without double assignment across many rows and payments', () => {
    const p1 = payment({ paymentId: 'p1', amountCents: 5_000 });
    const p2 = payment({
      paymentId: 'p2',
      amountCents: 5_000,
      unitLabel: 'Β2',
      createdAtIso: new Date(Date.parse('2026-08-01T10:00:00Z') + DAY_MS).toISOString(),
    });
    const rows = [
      row('2026-08-05', 5_000), // medium → p1
      row('2026-08-03', 5_000, 'εισπραξη Β2'), // high → p2
      row('2026-08-04', 5_000), // leftover low candidate
    ];
    const suggestions = suggestMatches(rows, [p1, p2]);
    expect(suggestions.map((s) => s.rowIndex).sort((a, b) => a - b)).toEqual([
      0, 1,
    ]);
    expect(suggestions.find((s) => s.rowIndex === 1)).toMatchObject({
      paymentId: 'p2',
      confidence: 'high',
    });
    expect(suggestions.filter((s) => s.paymentId === 'p2')).toHaveLength(1);
  });

  it('keeps output sorted by rowIndex regardless of confidence order', () => {
    const rows = [
      row('2026-12-31', 100, 'low-only'),
      row('2026-08-02', 200, 'medium'),
    ];
    const suggestions = suggestMatches(rows, [
      payment({ paymentId: 'x', amountCents: 200 }),
      payment({ paymentId: 'y', amountCents: 100 }),
    ]);
    expect(suggestions.map((s) => s.rowIndex)).toEqual([0, 1]);
    expect(suggestions.map((s) => s.confidence)).toEqual(['low', 'medium']);
  });

  it('respects the ±5 day window boundary exactly', () => {
    const latePayment = payment({ createdAtIso: '2026-08-01T23:00:00.000Z' });
    const inside = suggestMatches(
      [row('2026-08-06', 10_000)],
      [latePayment],
    );
    expect(inside[0].confidence).toBe('medium');
    const outside = suggestMatches(
      [row('2026-08-07', 10_000, 'pay-1')],
      [latePayment],
    );
    expect(outside[0].confidence).toBe('low');
  });
});
