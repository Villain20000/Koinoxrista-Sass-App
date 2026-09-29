import { buildLedgerRows, ledgerTotals } from './build-ledger';

const units = [
  { id: 'u-a', label: 'Α1' },
  { id: 'u-b', label: 'Β1' },
];

describe('buildLedgerRows', () => {
  it('aggregates share amounts per period, unit and description', () => {
    const rows = buildLedgerRows(
      '2026',
      [
        {
          description: 'Αντλία θερμότητας',
          periodYearMonth: '2026-01',
          shares: [
            { unitId: 'u-a', amountCents: 6_000 },
            { unitId: 'u-b', amountCents: 4_000 },
          ],
        },
        {
          description: 'Καθαρισμός',
          periodYearMonth: '2026-01',
          shares: [{ unitId: 'u-a', amountCents: 2_500 }],
        },
      ],
      units,
      [],
    );

    expect(rows).toHaveLength(3);
    // Ordered by period, then unit label, then description.
    expect(rows.map((row) => row.unitLabel)).toEqual(['Α1', 'Α1', 'Β1']);
    expect(rows[0]).toMatchObject({
      periodYearMonth: '2026-01',
      unitLabel: 'Α1',
      description: 'Αντλία θερμότητας',
      invoicedCents: 6_000,
      paidCents: 0,
      balanceCents: 6_000,
    });
    expect(rows[2]).toMatchObject({
      periodYearMonth: '2026-01',
      unitLabel: 'Β1',
      description: 'Αντλία θερμότητας',
      invoicedCents: 4_000,
    });
  });

  it('ignores expenses outside the requested year', () => {
    const rows = buildLedgerRows(
      '2026',
      [
        {
          description: 'Παλίο',
          periodYearMonth: '2025-12',
          shares: [{ unitId: 'u-a', amountCents: 9_999 }],
        },
      ],
      units,
      [],
    );
    expect(rows).toEqual([]);
  });

  it('allocates payments sequentially so Σ paid == invoice paidCents', () => {
    const rows = buildLedgerRows(
      '2026',
      [
        {
          description: 'Έξοδο Α',
          periodYearMonth: '2026-02',
          shares: [{ unitId: 'u-b', amountCents: 3_000 }],
        },
        {
          description: 'Έξοδο Β',
          periodYearMonth: '2026-02',
          shares: [{ unitId: 'u-b', amountCents: 5_000 }],
        },
      ],
      units,
      [{ unitId: 'u-b', periodYearMonth: '2026-02', paidCents: 4_000 }],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        description: 'Έξοδο Α',
        invoicedCents: 3_000,
        paidCents: 3_000,
        balanceCents: 0,
      }),
      expect.objectContaining({
        description: 'Έξοδο Β',
        invoicedCents: 5_000,
        paidCents: 1_000,
        balanceCents: 4_000,
      }),
    ]);
    const totals = ledgerTotals(rows);
    expect(totals.paidCents).toBe(4_000);
    expect(totals.balanceCents).toBe(4_000);
  });

  it('keeps per-unit-period payment pools separate', () => {
    const rows = buildLedgerRows(
      '2026',
      [
        {
          description: 'Κοινό',
          periodYearMonth: '2026-03',
          shares: [
            { unitId: 'u-a', amountCents: 1_000 },
            { unitId: 'u-b', amountCents: 1_000 },
          ],
        },
      ],
      units,
      [{ unitId: 'u-b', periodYearMonth: '2026-03', paidCents: 800 }],
    );

    const byUnit = new Map(rows.map((row) => [row.unitLabel, row]));
    expect(byUnit.get('Α1')?.paidCents).toBe(0);
    expect(byUnit.get('Β1')?.paidCents).toBe(800);
  });

  it('satisfies totals == Σ rows for invoiced, paid and balance', () => {
    const expenses = [
      {
        description: 'Ανελκυστήρας; συντήρηση "έκτακτη"',
        periodYearMonth: '2026-04',
        shares: [
          { unitId: 'u-a', amountCents: 7_777 },
          { unitId: 'u-b', amountCents: 2_223 },
        ],
      },
      {
        description: 'Δόκιμοι',
        periodYearMonth: '2026-05',
        shares: [{ unitId: 'u-a', amountCents: 500 }],
      },
    ];
    const invoices = [
      { unitId: 'u-a', periodYearMonth: '2026-04', paidCents: 10_000 },
      { unitId: 'u-b', periodYearMonth: '2026-05', paidCents: 300 },
    ];

    const rows = buildLedgerRows('2026', expenses, units, invoices);
    const totals = ledgerTotals(rows);

    expect(totals.invoicedCents).toBe(
      rows.reduce((sum, row) => sum + row.invoicedCents, 0),
    );
    expect(totals.paidCents).toBe(
      rows.reduce((sum, row) => sum + row.paidCents, 0),
    );
    expect(totals.balanceCents).toBe(
      rows.reduce((sum, row) => sum + row.balanceCents, 0),
    );
    expect(totals.invoicedCents - totals.paidCents).toBe(
      totals.balanceCents,
    );
  });
});
