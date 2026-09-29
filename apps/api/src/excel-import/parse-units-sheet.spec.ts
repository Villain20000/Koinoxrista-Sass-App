import ExcelJS from 'exceljs';
import {
  mapUnitsColumns,
  normalizeUnitLabel,
  parseCsvTable,
  parseIntCell,
  parseUnitsSheet,
  readSheetRows,
} from './parse-units-sheet';
import type { UnitsColumnMap } from './parse-units-sheet';

async function xlsxBuffer(
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Διαμερίσματα');
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function columns(header: string[]): UnitsColumnMap {
  const map = mapUnitsColumns(header);
  if (!map) throw new Error(`No label column in test header: ${header.join(',')}`);
  return map;
}

const GR_HEADER = [
  'Διαμέρισμα',
  'Όροφος',
  'Χιλιοστά',
  'Καλοριφέρ',
  'Email Ιδιοκτήτη',
];

describe('normalizeUnitLabel', () => {
  it('trims and lowercases for the upsert key', () => {
    expect(normalizeUnitLabel('  Α1 ')).toBe('α1');
    expect(normalizeUnitLabel('a1')).toBe(normalizeUnitLabel('A1'));
  });
});

describe('parseIntCell', () => {
  it('distinguishes empty, unparsable and valid integers', () => {
    expect(parseIntCell('')).toBeUndefined();
    expect(parseIntCell('   ')).toBeUndefined();
    expect(parseIntCell('12')).toBe(12);
    expect(parseIntCell(' -3 ')).toBe(-3);
    expect(parseIntCell('1.234')).toBe(1234);
    expect(parseIntCell('2 000')).toBe(2000);
    expect(parseIntCell('4,0')).toBe(4);
    expect(parseIntCell('Ισόγειο')).toBeNull();
    expect(parseIntCell('2.5')).toBeNull();
  });
});

describe('parseCsvTable', () => {
  it('detects semicolon vs comma delimiters and quoted fields', () => {
    const csv = [
      '"Διαμέρισμα";"Χιλιοστά"',
      '"Α;1";250',
      'Β2;750',
    ].join('\n');
    expect(parseCsvTable(csv)).toEqual([
      ['Διαμέρισμα', 'Χιλιοστά'],
      ['Α;1', '250'],
      ['Β2', '750'],
    ]);
  });

  it('strips BOM and skips blank lines', () => {
    expect(parseCsvTable('\uFEFFlabel,floor\n\nΑ1,0\n')).toEqual([
      ['label', 'floor'],
      ['Α1', '0'],
    ]);
  });
});

describe('mapUnitsColumns', () => {
  it('maps Greek headers in any order', () => {
    expect(
      mapUnitsColumns(['Χιλιοστά ‰', 'Email Ιδιοκτήτη', 'Όροφος', 'Διαμέρισμα']),
    ).toEqual({ label: 3, floor: 2, millimes: 0, radiatorCount: null, ownerEmail: 1 });
  });

  it('maps English synonyms and decorated headers', () => {
    expect(
      mapUnitsColumns(['Apartment', 'Floor', 'Millimes', 'Radiators (τεμ.)']),
    ).toEqual({ label: 0, floor: 1, millimes: 2, radiatorCount: 3, ownerEmail: null });
    expect(mapUnitsColumns(['label'])).toEqual({
      label: 0,
      floor: null,
      millimes: null,
      radiatorCount: null,
      ownerEmail: null,
    });
  });

  it('returns null when no label column exists', () => {
    expect(mapUnitsColumns(['Όροφος', 'Χιλιοστά'])).toBeNull();
  });
});

describe('readSheetRows', () => {
  it('reads the first worksheet of an in-memory xlsx workbook', async () => {
    const buffer = await xlsxBuffer([
      ['Διαμέρισμα', 'Όροφος', 'Χιλιοστά'],
      ['Γ3', 3, 334],
    ]);
    await expect(readSheetRows(buffer, 'katoikia.xlsx')).resolves.toEqual([
      ['Διαμέρισμα', 'Όροφος', 'Χιλιοστά'],
      ['Γ3', '3', '334'],
    ]);
  });

  it('sniffs xlsx by ZIP magic even without a known extension', async () => {
    const buffer = await xlsxBuffer([['Apartment', 'Millimes'], ['B2', 500]]);
    await expect(readSheetRows(buffer, 'upload.bin')).resolves.toEqual([
      ['Apartment', 'Millimes'],
      ['B2', '500'],
    ]);
  });

  it('falls back to tolerant CSV parsing for text files', async () => {
    const csv = 'Διαμέρισμα;Χιλιοστά\nΑ1;1000';
    const buffer = Buffer.from(csv, 'utf8');
    await expect(readSheetRows(buffer, 'monades.csv')).resolves.toEqual([
      ['Διαμέρισμα', 'Χιλιοστά'],
      ['Α1', '1000'],
    ]);
  });

  it('returns [] for an empty workbook', async () => {
    const buffer = await xlsxBuffer([]);
    await expect(readSheetRows(buffer, 'empty.xlsx')).resolves.toEqual([]);
  });
});

describe('parseUnitsSheet', () => {
  it('validates a full Greek sheet with counts and totals', () => {
    const table = [
      GR_HEADER,
      ['Α1', '0', '400', '3', 'owner@example.gr'],
      ['Β1', '1', '600', '', ''],
      ['', '', '', '', ''],
    ];
    expect(parseUnitsSheet(table, columns(GR_HEADER))).toEqual({
      rows: [
        {
          label: 'Α1',
          floor: 0,
          millimes: 400,
          radiatorCount: 3,
          ownerEmail: 'owner@example.gr',
          errors: [],
        },
        {
          label: 'Β1',
          floor: 1,
          millimes: 600,
          radiatorCount: null,
          ownerEmail: null,
          errors: [],
        },
      ],
      validCount: 2,
      errorCount: 0,
      totalMillimes: 1000,
      warnings: [],
    });
  });

  it('flags invalid millimes, bad email and unparsable floor per row', () => {
    const header = ['label', 'floor', 'millimes'];
    const result = parseUnitsSheet(
      [
        header,
        ['Α1', 'x', 'abc'],
        ['Β1', '2', '20000'],
        ['Γ1', '1', 'not-a-number'],
        ['Δ1', '', '150'],
      ],
      columns(header),
    );
    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(3);
    expect(result.rows[0].errors).toHaveLength(2);
    expect(result.rows[0].millimes).toBeNull();
    expect(result.rows[1].errors).toEqual([
      'Τα χιλιοστά πρέπει να είναι ακέραιος από 0 έως 10000.',
    ]);
    expect(result.rows[3]).toMatchObject({
      label: 'Δ1',
      floor: null,
      millimes: 150,
      errors: [],
    });
  });

  it('marks duplicate labels inside the file invalid but keeps the first', () => {
    const header = ['Διαμέρισμα', 'Χιλιοστά'];
    const result = parseUnitsSheet(
      [
        header,
        ['Α1 ', '600'],
        ['α1', '400'],
        [' Β1', '1000'],
      ],
      columns(header),
    );
    expect(result.validCount).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.rows[0].errors).toEqual([]);
    expect(result.rows[1].errors).toEqual(['Διπλή ετικέτα «α1» μέσα στο αρχείο.']);
  });

  it('warns when Σ millimes of valid rows ≠ 1000 but stays importable', () => {
    const header = ['Διαμέρισμα', 'Χιλιοστά'];
    const result = parseUnitsSheet(
      [header, ['Α1', '300'], ['Β1', '300']],
      columns(header),
    );
    expect(result.validCount).toBe(2);
    expect(result.totalMillimes).toBe(600);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('600');
  });

  it('requires millimes and tolerates negative floors (υπόγειο)', () => {
    const header = ['Διαμέρισμα', 'Όροφος', 'Χιλιοστά', 'Καλοριφέρ'];
    const result = parseUnitsSheet(
      [header, ['Υ1', '-1', '1000', '0'], ['Χ9', '2', '', '']],
      columns(header),
    );
    expect(result.validCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ floor: -1, radiatorCount: 0 });
    expect(result.rows[1].errors).toEqual([
      'Τα χιλιοστά πρέπει να είναι ακέραιος από 0 έως 10000.',
    ]);
  });

  it('rejects negative radiators and missing labels with errors kept inline', () => {
    const header = ['Apartment', 'Radiators'];
    const result = parseUnitsSheet(
      [header, ['Α1', '-2'], ['', '1']],
      columns(header),
    );
    expect(result.errorCount).toBe(2);
    expect(result.rows[0].errors).toContain(
      'Οι καλοριφέρ πρέπει να είναι ακέραιος ≥ 0 ή κενός.',
    );
    expect(result.rows[1].errors).toContain('Λείπει η ετικέτα του διαμερίσματος.');
  });

  it('returns an empty preview for a header-only sheet', () => {
    const result = parseUnitsSheet([GR_HEADER], columns(GR_HEADER));
    expect(result).toMatchObject({
      rows: [],
      validCount: 0,
      errorCount: 0,
      totalMillimes: 0,
      warnings: [],
    });
  });
});
