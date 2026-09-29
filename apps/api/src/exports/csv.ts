export type CsvCell = string | number | null | undefined;

/** Quotes and escapes a cell when it contains separators, quotes or line breaks. */
export function csvEscape(value: CsvCell): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Pure helper: renders a CSV document with semicolon separator, RFC quote
 * escaping and a UTF-8 BOM prefix so Excel opens Greek text correctly.
 */
export function toCsv(
  headers: string[],
  rows: Array<Array<CsvCell>>,
): string {
  const lines = [headers, ...rows].map((row) => row.map(csvEscape).join(';'));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
