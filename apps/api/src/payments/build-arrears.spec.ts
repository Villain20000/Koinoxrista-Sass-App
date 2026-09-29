import {
  buildArrears,
  bucketKeyFor,
  monthsBack,
} from './build-arrears';

const NOW = new Date('2026-08-15T10:00:00.000Z');

const unit = (id: string, label: string) => ({ id, label });
const ownership = (unitId: string, first: string, last: string) => ({
  unitId,
  user: { firstName: first, lastName: last },
});
const invoice = (
  unitId: string,
  periodYearMonth: string,
  totalCents: number,
  paidCents: number,
) => ({ unitId, periodYearMonth, totalCents, paidCents });

describe('monthsBack / bucketKeyFor', () => {
  it('computes whole months between periods', () => {
    expect(monthsBack('2026-08', '2026-08')).toBe(0);
    expect(monthsBack('2026-07', '2026-08')).toBe(1);
    expect(monthsBack('2025-08', '2026-08')).toBe(12);
    expect(monthsBack('2026-09', '2026-08')).toBe(-1);
  });

  it('maps ages to aging buckets', () => {
    expect(bucketKeyFor(0)).toBe('bucketCurrentCents');
    expect(bucketKeyFor(1)).toBe('bucket30Cents');
    expect(bucketKeyFor(2)).toBe('bucket60Cents');
    expect(bucketKeyFor(3)).toBe('bucket90PlusCents');
    expect(bucketKeyFor(24)).toBe('bucket90PlusCents');
  });
});

describe('buildArrears', () => {
  it('buckets each unpaid remainder by invoice age', () => {
    const report = buildArrears(
      'building-1',
      [unit('u1', 'Α1')],
      [ownership('u1', 'Νίκος', 'Παπαδόπουλος')],
      [
        invoice('u1', '2026-08', 10_000, 4_000),
        invoice('u1', '2026-07', 10_000, 0),
        invoice('u1', '2026-06', 5_000, 0),
        invoice('u1', '2026-01', 2_000, 500),
      ],
      NOW,
    );

    expect(report.rows).toHaveLength(1);
    const row = report.rows[0];
    expect(row.outstandingCents).toBe(22_500);
    expect(row.bucketCurrentCents).toBe(6_000);
    expect(row.bucket30Cents).toBe(10_000);
    expect(row.bucket60Cents).toBe(5_000);
    expect(row.bucket90PlusCents).toBe(1_500);
    expect(row.oldestUnpaidPeriod).toBe('2026-01');
    expect(row.ownerNames).toEqual(['Νίκος Παπαδόπουλος']);
    expect(report.totalOutstandingCents).toBe(22_500);
  });

  it('skips units whose invoices are fully paid and drops paid remainders', () => {
    const report = buildArrears(
      'building-1',
      [unit('u1', 'Α1'), unit('u2', 'Β1')],
      [],
      [
        invoice('u1', '2026-08', 10_000, 10_000),
        invoice('u2', '2026-08', 10_000, 0),
        invoice('u2', '2026-07', 10_000, 10_000),
      ],
      NOW,
    );

    expect(report.rows.map((row) => row.unitLabel)).toEqual(['Β1']);
    expect(report.rows[0].outstandingCents).toBe(10_000);
    expect(report.rows[0].bucketCurrentCents).toBe(10_000);
  });

  it('satisfies Σ buckets == Σ outstanding across all rows', () => {
    const report = buildArrears(
      'building-1',
      [unit('u1', 'Α1'), unit('u2', 'Β2')],
      [],
      [
        invoice('u1', '2026-08', 9_999, 1),
        invoice('u1', '2026-05', 4_200, 200),
        invoice('u2', '2026-02', 7_777, 777),
        invoice('u2', '2024-12', 1_234, 0),
        invoice('u2', '2026-08', 500, 500),
      ],
      NOW,
    );

    for (const row of report.rows) {
      const bucketSum =
        row.bucketCurrentCents +
        row.bucket30Cents +
        row.bucket60Cents +
        row.bucket90PlusCents;
      expect(bucketSum).toBe(row.outstandingCents);
    }
    const totalOutstanding = report.rows.reduce(
      (sum, row) => sum + row.outstandingCents,
      0,
    );
    expect(report.totalOutstandingCents).toBe(totalOutstanding);
    expect(totalOutstanding).toBeGreaterThan(0);
  });

  it('returns an empty report when nothing is owed', () => {
    const report = buildArrears('building-1', [], [], [], NOW);
    expect(report).toEqual({
      buildingId: 'building-1',
      generatedAt: NOW.toISOString(),
      totalOutstandingCents: 0,
      rows: [],
    });
  });
});
