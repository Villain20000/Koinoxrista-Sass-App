import { parseBankCsv } from './parse-bank-csv';

describe('parseBankCsv', () => {
  it('returns [] for empty or blank input', () => {
    expect(parseBankCsv('')).toEqual([]);
    expect(parseBankCsv('\n \r\n\t\n')).toEqual([]);
  });

  it('parses comma-delimited rows with decimal point dates and positional columns', () => {
    expect(
      parseBankCsv('2026-08-01,123.45,REF-1\n2026-08-02,10,REF-2'),
    ).toEqual([
      { dateIso: '2026-08-01', amountCents: 12_345, reference: 'REF-1' },
      { dateIso: '2026-08-02', amountCents: 1_000, reference: 'REF-2' },
    ]);
  });

  it('parses semicolon-delimited Greek exports with decimal comma', () => {
    const csv = [
      '01/08/2026;123,45;ΕΘΝΕΣΙΜΗ ΤΡΑΠΕΖΑ;ΚΑΤΑΘΕΣΗ',
      '15/08/2026;"1.234,56";PIRAEUS;ΑΝΑΛΗΨΗ',
    ].join('\n');
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-08-01', amountCents: 12_345, reference: 'ΕΘΝΕΣΙΜΗ ΤΡΑΠΕΖΑ' },
      { dateIso: '2026-08-15', amountCents: 123_456, reference: 'PIRAEUS' },
    ]);
  });

  it('handles quoted fields containing delimiters, quotes and newlines-in-cell text', () => {
    const csv =
      '"2026-03-05","50,10","Πληρωμή ""Α.Β."" μέσω IRIS; έγκυρη"';
    expect(parseBankCsv(csv)).toEqual([
      {
        dateIso: '2026-03-05',
        amountCents: 5_010,
        reference: 'Πληρωμή "Α.Β." μέσω IRIS; έγκυρη',
      },
    ]);
  });

  it('maps columns by Greek header names in any order', () => {
    const csv = [
      'Ποσό;Αιτιολογία;Ημερομηνία',
      '100,00;ΔΟΣΗ Α1;02/09/2026',
    ].join('\n');
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-09-02', amountCents: 10_000, reference: 'ΔΟΣΗ Α1' },
    ]);
  });

  it('maps columns by English header names', () => {
    const csv = [
      'Date,Amount,Description',
      '2026-07-11,"25.90",DUES UNIT B2',
    ].join('\n');
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-07-11', amountCents: 2_590, reference: 'DUES UNIT B2' },
    ]);
  });

  it('does not treat a data row as a header even when extra columns exist', () => {
    const csv = '2026-05-05,99.99,SOMETHING,EXTRA';
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-05-05', amountCents: 9_999, reference: 'SOMETHING' },
    ]);
  });

  it('skips garbage preamble lines before positional data rows', () => {
    const csv = [
      'ΤΡΑΠΕΖΑ ΠΕΙΡΑΙΩΣ — ΚΙΝΗΣΕΙΣ ΛΟΓΑΡΙΑΣΜΟΥ',
      'IBAN: GR16 0110 1250 0000 0001 2300 695',
      'Από 01/06/2026 έως 30/06/2026',
      '2026-06-10;120,00;KATATHESI',
      '2026-06-20;80.50;WEB BANKING',
    ].join('\n');
    // The preamble lines fail date+amount parsing at the fallback positions.
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-06-10', amountCents: 12_000, reference: 'KATATHESI' },
      { dateIso: '2026-06-20', amountCents: 8_050, reference: 'WEB BANKING' },
    ]);
  });

  it('skips rows with unparsable dates or amounts but keeps valid neighbours', () => {
    const csv = [
      'not-a-date,10,SKIP',
      '31/02/2026,10,SKIP',
      '2026-08-03,abc,SKIP',
      '2026-08-04,,SKIP',
      '2026-08-05,7.77,KEEP',
    ].join('\n');
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-08-05', amountCents: 777, reference: 'KEEP' },
    ]);
  });

  it('keeps only positive incoming credits (debits, zeros excluded)', () => {
    const csv = [
      '2026-08-05,-50.00,DEBIT',
      '2026-08-05,(120,45),PAREN DEBIT',
      '2026-08-05,0,ZERO',
      '2026-08-05,1,CREDIT',
    ].join('\n');
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-08-05', amountCents: 100, reference: 'CREDIT' },
    ]);
  });

  it('accepts both date formats plus dotted day-first variant and validates ranges', () => {
    expect(
      parseBankCsv(
        [
          '2024-02-29,1,A',
          '05/01/2026,2,B',
          '06.01.2026,3,C',
          '2026-13-01,4,D',
          '2026-00-10,5,E',
        ].join('\n'),
      ),
    ).toEqual([
      { dateIso: '2024-02-29', amountCents: 100, reference: 'A' },
      { dateIso: '2026-01-05', amountCents: 200, reference: 'B' },
      { dateIso: '2026-01-06', amountCents: 300, reference: 'C' },
    ]);
  });

  it('handles CRLF line endings and currency symbols', () => {
    const csv = '2026-08-08;€ 1.234,56;EUR\r\n2026-08-09;EUR 9,9;B\n';
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-08-08', amountCents: 123_456, reference: 'EUR' },
      { dateIso: '2026-08-09', amountCents: 990, reference: 'B' },
    ]);
  });

  it('rounds sub-cent fractions deterministically (decimal comma padding)', () => {
    const csv = ['2026-08-01;10,5;A', '2026-08-01;10,55;B'].join('\n');
    expect(parseBankCsv(csv)).toEqual([
      { dateIso: '2026-08-01', amountCents: 1_050, reference: 'A' },
      { dateIso: '2026-08-01', amountCents: 1_055, reference: 'B' },
    ]);
  });
});
