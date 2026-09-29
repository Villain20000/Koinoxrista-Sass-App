import type { ParsedBankRowDto } from '@org/shared';

const DATE_KEYS = ['ημερομηνια', 'ημνια', 'date'];
const AMOUNT_KEYS = ['ποσο', 'amount'];
const REFERENCE_KEYS = ['αιτιολογια', 'περιγραφη', 'reference', 'description'];

interface ColumnMap {
  dateIdx: number;
  amountIdx: number;
  referenceIdx: number;
}

function normalizeField(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ς/g, 'σ')
    .replace(/[^a-z\u0370-\u03ff0-9]/g, '');
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' && current.length === 0) {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function detectDelimiter(lines: string[]): string {
  let commas = 0;
  let semicolons = 0;
  for (const line of lines) {
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes) {
        if (ch === ',') commas++;
        else if (ch === ';') semicolons++;
      }
    }
  }
  return semicolons > commas ? ';' : ',';
}

function columnsFromHeader(fields: string[]): ColumnMap | null {
  const map: ColumnMap = { dateIdx: -1, amountIdx: -1, referenceIdx: -1 };
  fields.forEach((field, idx) => {
    const key = normalizeField(field);
    if (!key) return;
    if (map.dateIdx < 0 && DATE_KEYS.includes(key)) map.dateIdx = idx;
    else if (map.amountIdx < 0 && AMOUNT_KEYS.includes(key)) map.amountIdx = idx;
    else if (map.referenceIdx < 0 && REFERENCE_KEYS.includes(key))
      map.referenceIdx = idx;
  });
  return map.dateIdx >= 0 || map.amountIdx >= 0 ? map : null;
}

function toYmd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return dt.toISOString().slice(0, 10);
}

function parseBankDate(raw: string): string | null {
  const s = raw.trim();
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (ymd) return toYmd(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (dmy) return toYmd(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  return null;
}

/**
 * Parses a bank amount into integer cents. Accepts decimal comma
 * ("123,45", "1.234,56") and decimal point ("123.45"), currency symbols,
 * thousands separators and parenthesised negatives.
 */
function parseBankAmountCents(raw: string): number | null {
  const negative = /^\s*[(-]/.test(raw);
  const cleaned = raw
    .replace(/eur/gi, '')
    .replace(/[^\d.,-]/g, '')
    .replace(/-/g, '');
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let decSep = '';
  if (lastComma >= 0 && lastDot >= 0) {
    decSep = lastComma > lastDot ? ',' : '.';
  } else if (lastComma >= 0) {
    decSep = ',';
  } else if (lastDot >= 0 && !/^(\d{1,3})(\.\d{3})+$/.test(cleaned)) {
    decSep = '.';
  }

  let intPart: string;
  let fracPart: string;
  if (decSep) {
    const idx = cleaned.lastIndexOf(decSep);
    intPart = cleaned.slice(0, idx).replace(/\D/g, '');
    fracPart = cleaned.slice(idx + 1).replace(/\D/g, '').slice(0, 2);
  } else {
    intPart = cleaned.replace(/\D/g, '');
    fracPart = '';
  }
  if (!intPart && !fracPart) return null;

  const cents =
    Number(intPart || '0') * 100 +
    Number((fracPart + '00').slice(0, 2) || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * Tolerant bank-statement CSV parser. Supports comma/semicolon delimiters,
 * quoted fields, decimal comma or point, dd/mm/yyyy and yyyy-mm-dd dates.
 * Columns are mapped by header names when present, otherwise positionally
 * (date, amount, reference). Rows without a parsable date+amount are skipped,
 * as are non-positive amounts — only incoming credits survive.
 */
export function parseBankCsv(text: string): ParsedBankRowDto[] {
  const lines = splitLines(text);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines);
  const table = lines.map((line) => splitCsvLine(line, delimiter));

  let columns: ColumnMap | null = null;
  let dataRows = table;
  const headerCandidate = columnsFromHeader(table[0]);
  if (
    headerCandidate &&
    parseBankDate(table[0][headerCandidate.dateIdx]) === null &&
    parseBankAmountCents(table[0][headerCandidate.amountIdx]) === null
  ) {
    columns = headerCandidate;
    dataRows = table.slice(1);
  }

  const rows: ParsedBankRowDto[] = [];
  for (const fields of dataRows) {
    const cols = columns ?? { dateIdx: 0, amountIdx: 1, referenceIdx: 2 };
    const dateIso = parseBankDate(fields[cols.dateIdx] ?? '');
    const amountCents = parseBankAmountCents(fields[cols.amountIdx] ?? '');
    if (!dateIso || amountCents === null || amountCents <= 0) continue;
    rows.push({
      dateIso,
      amountCents,
      reference: (fields[cols.referenceIdx] ?? '').trim(),
    });
  }
  return rows;
}
