import { csvEscape, toCsv } from './csv';

describe('csvEscape', () => {
  it('leaves plain values untouched', () => {
    expect(csvEscape('Α1')).toBe('Α1');
    expect(csvEscape(1234)).toBe('1234');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('quotes cells containing the semicolon separator', () => {
    expect(csvEscape('a;b')).toBe('"a;b"');
  });

  it('escapes quotes by doubling and wraps in quotes', () => {
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes cells containing line breaks', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('a\rb')).toBe('"a\rb"');
  });
});

describe('toCsv', () => {
  const headers = ['Περίοδος', 'Διαμέρισμα', 'Ποσό'];

  it('prefixes a UTF-8 BOM so Excel detects Greek text', () => {
    const csv = toCsv(headers, []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith('Περίοδος')).toBe(true);
  });

  it('joins cells with semicolons and rows with CRLF', () => {
    const csv = toCsv(headers, [['2026-07', 'Α1', 1000]]);
    expect(csv).toBe('\uFEFFΠερίοδος;Διαμέρισμα;Ποσό\r\n2026-07;Α1;1000\r\n');
  });

  it('keeps separator-bearing values inside one column', () => {
    const row = toCsv(['a', 'b'], [['x;y', '"q"']]).slice(1).trimEnd().split('\r\n')[1];
    expect(row).toBe('"x;y";"""q"""');
  });
});
