import ExcelJS from 'exceljs';
import { TOTAL_MILLIMES } from '@org/shared';
import type { UnitImportRowDto } from '@org/shared';

/** Hard cap per row; Σ across rows may exceed 1000 (warning only). */
export const MILLIMES_MIN = 0;
export const MILLIMES_MAX = 10_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UnitsColumnKey =
  | 'label'
  | 'floor'
  | 'millimes'
  | 'radiatorCount'
  | 'ownerEmail';

const COLUMN_ORDER: UnitsColumnKey[] = [
  'label',
  'floor',
  'millimes',
  'radiatorCount',
  'ownerEmail',
];

/**
 * Header synonyms GR+EN. Values are already accent-stripped / normalized
 * (see `normalizeField`): Διαμέρισμα → `διαμερισμα`, Καλοριφέρ → `καλοριφερ`.
 */
const COLUMN_SYNONYMS_RAW: Record<UnitsColumnKey, string[]> = {
  label: [
    'διαμερισματα',
    'διαμέρισμα',
    'κωδικός',
    'μονάδα',
    'apartment',
    'apt',
    'label',
    'unit',
  ],
  floor: ['όροφος', 'όροφοι', 'floor'],
  millimes: ['χιλιοστά', 'χιλ', 'υποδιαιρέματα', 'millimes', 'permille'],
  radiatorCount: ['καλοριφέρ', 'καλοριφέρια', 'radiators', 'radiatorcount', 'radiator'],
  ownerEmail: ['owner email', 'email ιδιοκτήτη', 'ιδιοκτήτης', 'email'],
};

/** Synonyms pushed through the same normalizer as sheet headers (ς→σ etc.). */
const COLUMN_SYNONYMS = Object.fromEntries(
  Object.entries(COLUMN_SYNONYMS_RAW).map(([key, list]) => [
    key,
    list.map(normalizeField),
  ]),
) as Record<UnitsColumnKey, string[]>;

export interface UnitsColumnMap {
  label: number;
  floor: number | null;
  millimes: number | null;
  radiatorCount: number | null;
  ownerEmail: number | null;
}

export interface ParsedUnitsSheet {
  rows: UnitImportRowDto[];
  validCount: number;
  errorCount: number;
  totalMillimes: number;
  warnings: string[];
}

/** Lowercase, strip Greek/Latin diacritics and everything but letters/digits. */
function normalizeField(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ς/g, 'σ')
    .replace(/[^a-z\u0370-\u03ff0-9]/g, '');
}

/** Upsert key: case-insensitive trim (matches the API's uniqueness intent). */
export function normalizeUnitLabel(raw: string): string {
  return raw.trim().toLowerCase();
}

function keyForHeader(header: string): UnitsColumnKey | null {
  const norm = normalizeField(header);
  if (!norm) return null;
  for (const key of COLUMN_ORDER) {
    if (COLUMN_SYNONYMS[key].includes(norm)) return key;
  }
  // Tolerant second pass for decorated headers such as "Χιλιοστά ‰" or
  // "Radiators (τεμ.)": unambiguous known-synonym prefixes only.
  for (const key of COLUMN_ORDER) {
    if (
      norm.length >= 4 &&
      COLUMN_SYNONYMS[key].some((s) => s.length >= 4 && norm.startsWith(s))
    ) {
      return key;
    }
  }
  return null;
}

/**
 * Maps the header row to column indexes. Returns null when no label column is
 * recognized — the label is the upsert key, so a sheet without one is unusable.
 */
export function mapUnitsColumns(headerCells: string[]): UnitsColumnMap | null {
  const map: UnitsColumnMap = {
    label: -1,
    floor: null,
    millimes: null,
    radiatorCount: null,
    ownerEmail: null,
  };
  headerCells.forEach((cell, idx) => {
    const key = keyForHeader(cell);
    if (!key) return;
    if (key === 'label') {
      if (map.label < 0) map.label = idx;
    } else if (map[key] === null) {
      map[key] = idx;
    }
  });
  return map.label >= 0 ? map : null;
}

/**
 * Parses a spreadsheet cell into an integer:
 * undefined = empty (optional), null = present but unparsable.
 * Tolerates spaces/thousands-grouping dots ("1.234", "2 000") and
 * trailing comma zeros ("4,0").
 */
export function parseIntCell(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  let cleaned = trimmed.replace(/[\s\u00a0\u202f']/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '');
  }
  if (/^[+-]?\d+,0+$/.test(cleaned)) {
    cleaned = cleaned.replace(/,0+$/, '');
  }
  return /^[+-]?\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/** Splits CSV text into a table of trimmed cells (comma or semicolon). */
export function parseCsvTable(text: string): string[][] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  let commas = 0;
  let semicolons = 0;
  for (const line of lines) {
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes) {
        if (ch === ',') commas++;
        else if (ch === ';') semicolons++;
      }
    }
  }
  const delimiter = semicolons > commas ? ';' : ',';

  return lines.map((line) => {
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
  });
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && value !== null) {
    const record = value as unknown as Record<string, unknown>;
    if (record.result !== undefined) {
      return cellToString(record.result as ExcelJS.CellValue);
    }
    if (record.richText !== undefined && Array.isArray(record.richText)) {
      return (record.richText as { text?: unknown }[])
        .map((part) => String(part.text ?? ''))
        .join('')
        .trim();
    }
    if (record.text !== undefined) return String(record.text).trim();
    if (record.hyperlink !== undefined) return String(record.hyperlink);
    return '';
  }
  return '';
}

function worksheetToTable(worksheet: ExcelJS.Worksheet): string[][] {
  const table: string[][] = [];
  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      cells.push(cellToString(row.getCell(c).value));
    }
    table.push(cells);
  }
  return table;
}

function isXlsxBuffer(filename: string, buffer: Buffer): boolean {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return true;
  // ZIP local-file-header magic: xlsx containers always start with "PK".
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Reads the first worksheet of an .xlsx/.xlsm workbook, or falls back to
 * tolerant CSV parsing for plain-text files (decimal/thousands separators,
 * quoted fields, comma or semicolon delimiters).
 */
export async function readSheetRows(
  buffer: Buffer,
  filename = '',
): Promise<string[][]> {
  if (isXlsxBuffer(filename, buffer)) {
    const workbook = new ExcelJS.Workbook();
    // exceljs types its input as its own ArrayBuffer-based Buffer interface.
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const worksheet = workbook.worksheets[0];
    return worksheet ? worksheetToTable(worksheet) : [];
  }
  return parseCsvTable(buffer.toString('utf8'));
}

/**
 * Validates data rows against the mapped columns. Invalid rows keep their raw
 * values plus Greek error entries so the preview can highlight them; they are
 * never inserted. Duplicate labels inside the file are flagged (the upsert
 * would be ambiguous), blank rows are skipped silently.
 */
export function parseUnitsSheet(
  table: string[][],
  columns: UnitsColumnMap,
): ParsedUnitsSheet {
  const rows: UnitImportRowDto[] = [];
  const seenLabels = new Set<string>();

  for (let rowIdx = 1; rowIdx < table.length; rowIdx++) {
    const cells = table[rowIdx];
    const labelRaw = (cells[columns.label] ?? '').trim();
    // exceljs yields fully blank padding rows; CSV blanks were dropped earlier.
    if (!cells.some((cell) => cell.trim().length > 0)) continue;

    const errors: string[] = [];

    if (!labelRaw) {
      errors.push('Λείπει η ετικέτα του διαμερίσματος.');
    } else if (seenLabels.has(normalizeUnitLabel(labelRaw))) {
      errors.push(`Διπλή ετικέτα «${labelRaw}» μέσα στο αρχείο.`);
    } else {
      seenLabels.add(normalizeUnitLabel(labelRaw));
    }

    const floorCell =
      columns.floor === null ? undefined : cells[columns.floor] ?? '';
    const floor = floorCell === undefined ? undefined : parseIntCell(floorCell);
    if (floor === null) {
      errors.push('Ο όροφος πρέπει να είναι ακέραιος ή κενός.');
    }

    const millimesCell =
      columns.millimes === null ? '' : (cells[columns.millimes] ?? '');
    const millimes = parseIntCell(millimesCell);
    if (
      millimes === undefined ||
      millimes === null ||
      millimes < MILLIMES_MIN ||
      millimes > MILLIMES_MAX ||
      !Number.isInteger(millimes)
    ) {
      errors.push(
        `Τα χιλιοστά πρέπει να είναι ακέραιος από ${MILLIMES_MIN} έως ${MILLIMES_MAX}.`,
      );
    }

    const radiatorCell =
      columns.radiatorCount === null
        ? undefined
        : cells[columns.radiatorCount] ?? '';
    const radiatorCount =
      radiatorCell === undefined ? undefined : parseIntCell(radiatorCell);
    if (radiatorCount !== undefined && (radiatorCount === null || radiatorCount < 0)) {
      errors.push('Οι καλοριφέρ πρέπει να είναι ακέραιος ≥ 0 ή κενός.');
    }

    const emailCell =
      columns.ownerEmail === null ? '' : (cells[columns.ownerEmail] ?? '');
    const ownerEmail = emailCell.trim() || null;
    if (ownerEmail !== null && !EMAIL_RE.test(ownerEmail)) {
      errors.push('Μη έγκυρο email ιδιοκτήτη.');
    }

    rows.push({
      label: labelRaw,
      floor: floor ?? null,
      millimes: millimes ?? null,
      radiatorCount: radiatorCount ?? null,
      ownerEmail,
      errors,
    });
  }

  const validRows = rows.filter((row) => row.errors.length === 0);
  const totalMillimes = validRows.reduce(
    (sum, row) => sum + (row.millimes ?? 0),
    0,
  );
  const warnings: string[] = [];
  if (validRows.length > 0 && totalMillimes !== TOTAL_MILLIMES) {
    warnings.push(
      `Το άθροισμα χιλιοστών των έγκυρων γραμμών είναι ${totalMillimes} αντί για ${TOTAL_MILLIMES}. Η εισαγωγή επιτρέπεται, ελέγξτε τις τιμές.`,
    );
  }

  return {
    rows,
    validCount: validRows.length,
    errorCount: rows.length - validRows.length,
    totalMillimes,
    warnings,
  };
}
