import { Injectable } from '@nestjs/common';

/**
 * Simple stub OCR service — extracts invoice fields from raw PDF/text buffers
 * using deterministic regex patterns for € amounts, AFM (9-digit VAT) and dates.
 * Not a real OCR engine; suitable for unit tests and demo data.
 */
export interface OcrResult {
  issuerName: string | null;
  issuerAfm: string | null;
  issueDate: string | null; // ISO YYYY-MM-DD
  netCents: number | null;
  vatCents: number | null;
  totalCents: number | null;
  currency: string;
  confidence: number; // 0..100
  rawText: string;
  amounts: number[]; // all detected cents
}

const AFM_REGEX = /(?:ΑΦΜ|AFM)?\s*[:\-]?\s*(\d{9})/i;
const DATE_PATTERNS: RegExp[] = [
  /(\d{4})[-\/.](\d{2})[-\/.](\d{2})/, // YYYY-MM-DD
  /(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/, // DD/MM/YYYY or DD-MM-YYYY
];

const EURO_TOKEN = /(?:€|EUR|ευρώ)/i;

function parseEuroAmount(raw: string): number | null {
  // raw like "1.234,56" or "1,234.56" or "123,45" or "123.45"
  let s = raw.trim();
  // strip currency symbols
  s = s.replace(EURO_TOKEN, '').trim();
  // keep only digits, dots, commas, spaces
  s = s.replace(/[^\d.,\s]/g, '').replace(/\s/g, '');
  if (!s) return null;
  // If both separators present, last one is decimal
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalSep: string | null = null;
  if (lastDot !== -1 && lastComma !== -1) {
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (lastComma !== -1) {
    // Check if comma is decimal (2 digits after) else thousands
    const after = s.slice(lastComma + 1);
    decimalSep = after.length === 2 ? ',' : null;
  } else if (lastDot !== -1) {
    const after = s.slice(lastDot + 1);
    decimalSep = after.length === 2 ? '.' : null;
  }

  if (decimalSep === ',') {
    // remove dots (thousands), replace comma with dot
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (decimalSep === '.') {
    s = s.replace(/,/g, '');
  } else {
    // no decimal separator detected, treat as integer euros? but we expect cents
    s = s.replace(/[.,]/g, '');
    // consider as euros without cents => *100
    const val = Number(s);
    if (!Number.isFinite(val)) return null;
    return Math.round(val * 100);
  }

  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

function extractAmounts(text: string): number[] {
  // Find patterns that look like monetary values near € or with decimal 2
  // Strategy: find all substrings matching \d[\d\s.,]*[.,]\d{2}
  const regex = /(\d[\d\s.,]*[.,]\d{2})/g;
  const results: number[] = [];
  let m: RegExpExecArray | null;
  // First pass: amounts with explicit currency nearby (within 10 chars)
  const currencyRegex = /(\d[\d\s.,]*[.,]\d{2})\s*(?:€|EUR|ευρώ)/gi;
  while ((m = currencyRegex.exec(text)) !== null) {
    const cents = parseEuroAmount(m[1]);
    if (cents !== null && cents > 0 && cents < 10_000_000_00) {
      results.push(cents);
    }
  }
  // Second pass: any decimal amounts if we found none with currency
  if (results.length === 0) {
    while ((m = regex.exec(text)) !== null) {
      // Heuristic: context has € token within 30 chars before or after
      const idx = m.index;
      const snippet = text.slice(Math.max(0, idx - 30), idx + m[0].length + 30);
      const hasCurrencyNearby = EURO_TOKEN.test(snippet) || /σύνολο|total|αξία|net|vat|φόρος|ΦΠΑ/i.test(snippet);
      // Even without, consider if number is plausible invoice amount (100..50000 euros => 10000..5M cents)
      const cents = parseEuroAmount(m[1]);
      if (cents !== null && cents >= 100 && cents < 100_000_00) {
        // if hasCurrencyNearby or cents between 1 and 100k, keep
        if (hasCurrencyNearby || (cents >= 5000 && cents <= 10_000_00)) {
          results.push(cents);
        }
      }
    }
  }
  return [...new Set(results)].sort((a, b) => b - a);
}

function extractAfm(text: string): string | null {
  // Try explicit AFM label first
  const labeled = /(?:ΑΦΜ|AFM)\s*[:\-]?\s*(\d{9})/i.exec(text);
  if (labeled) return labeled[1];
  // Fallback: any 9-digit standalone number that is not part of longer number
  const generic = /\b(\d{9})\b/.exec(text);
  if (generic) {
    // Avoid matching amounts like 123456789 as AFM if it looks like phone? Accept anyway for stub
    return generic[1];
  }
  return null;
}

function extractDate(text: string): string | null {
  // Try YYYY-MM-DD first
  let m = /(\d{4})[-\/.](\d{2})[-\/.](\d{2})/.exec(text);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return iso;
  }
  // Try DD/MM/YYYY
  m = /(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/.exec(text);
  if (m) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return iso;
  }
  return null;
}

function extractIssuerName(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  // Look for explicit label
  for (const line of lines) {
    const lm = /(?:Προμηθευτής|Supplier|Επωνυμία|Issuer|Εκδότης)\s*[:\-]\s*(.+)/i.exec(line);
    if (lm) return lm[1].trim().slice(0, 200);
  }
  // Fallback: first line that is not a date/amount/afm
  for (const line of lines.slice(0, 5)) {
    if (line.length < 3) continue;
    if (AFM_REGEX.test(line)) continue;
    if (DATE_PATTERNS.some((re) => re.test(line))) continue;
    if (/^\d[\d\s.,]*[.,]\d{2}\s*(?:€|EUR)?$/i.test(line.trim())) continue;
    if (line.toLowerCase().includes('τιμολόγιο') || line.toLowerCase().includes('invoice')) continue;
    return line.slice(0, 200);
  }
  return lines[0]?.slice(0, 200) ?? null;
}

@Injectable()
export class OcrService {
  /**
   * Extracts invoice data from a raw PDF buffer treated as UTF-8 text.
   * For binary PDFs the buffer will be mostly unreadable — we still regex
   * over its textual representation as a deterministic stub.
   */
  async extractFromBuffer(buffer: Buffer, _filename?: string): Promise<OcrResult> {
    const text = buffer.toString('utf8');
    return this.extractFromText(text);
  }

  extractFromText(text: string): OcrResult {
    const rawText = text;
    const issuerName = extractIssuerName(text);
    const issuerAfm = extractAfm(text);
    const issueDate = extractDate(text);
    const amounts = extractAmounts(text);

    let netCents: number | null = null;
    let vatCents: number | null = null;
    let totalCents: number | null = null;

    if (amounts.length === 1) {
      totalCents = amounts[0];
      // Estimate VAT 24% split if only total available: net = total /1.24
      // For stub we keep net/vat null and let caller derive
    } else if (amounts.length >= 2) {
      // Heuristic: largest is total, second largest is net, vat = total - net if positive
      totalCents = amounts[0];
      // Try to find VAT explicitly via keyword
      const vatMatch = /(?:ΦΠΑ|VAT|Φόρος)[\s:]*([0-9\s.,]+[.,]\d{2})/i.exec(text);
      if (vatMatch) {
        const vat = parseEuroAmount(vatMatch[1]);
        if (vat !== null) {
          vatCents = vat;
          // net could be total - vat
          if (totalCents !== null && vatCents < totalCents) {
            netCents = totalCents - vatCents;
          }
        }
      }
      if (netCents === null) {
        // fallback: second largest as net if sum makes sense
        const candidateNet = amounts[1];
        if (candidateNet < totalCents) {
          netCents = candidateNet;
          vatCents = totalCents - candidateNet;
        }
      }
      // If we still have no vat/net, try third amount as vat
      if (vatCents === null && amounts.length >= 3) {
        const candVat = amounts[2];
        if (candVat < (totalCents ?? Infinity) && candVat < (netCents ?? Infinity)) {
          vatCents = candVat;
          if (totalCents !== null && netCents === null) {
            netCents = totalCents - vatCents;
          }
        }
      }
    }

    // Clean up vat if negative or unrealistic
    if (vatCents !== null && vatCents < 0) vatCents = null;
    if (netCents !== null && vatCents !== null && totalCents !== null) {
      if (netCents + vatCents !== totalCents) {
        // Prefer total to be ground truth; adjust vat if small mismatch (rounding)
        const diff = totalCents - (netCents + (vatCents ?? 0));
        if (Math.abs(diff) <= 2 && vatCents !== null) {
          vatCents += diff;
        }
      }
    }

    // Confidence: fraction of fields detected
    const fields = [issuerName, issuerAfm, issueDate, netCents, vatCents, totalCents];
    const detected = fields.filter((v) => v !== null && v !== undefined).length;
    const confidence = Math.round((detected / fields.length) * 100);

    // Default currency EUR
    return {
      issuerName,
      issuerAfm,
      issueDate,
      netCents,
      vatCents,
      totalCents,
      currency: 'EUR',
      confidence,
      rawText: rawText.slice(0, 5000),
      amounts,
    };
  }

  /**
   * Convenience helper for unit tests — builds a fake PDF-like text blob
   * containing the provided fields in a recognizable greek invoice layout.
   */
  static buildFakeInvoiceText(opts: {
    issuerName?: string;
    issuerAfm?: string;
    issueDate?: string;
    netCents?: number;
    vatCents?: number;
    totalCents?: number;
  }): string {
    const fmt = (cents?: number) =>
      cents != null ? `${(cents / 100).toFixed(2).replace('.', ',')} €` : '';
    return [
      `ΤΙΜΟΛΟΓΙΟ ΠΩΛΗΣΗΣ`,
      `Προμηθευτής: ${opts.issuerName ?? 'ΑΓΝΩΣΤΟΣ ΠΡΟΜΗΘΕΥΤΗΣ'}`,
      `ΑΦΜ: ${opts.issuerAfm ?? '123456789'}`,
      `Ημερομηνία: ${opts.issueDate ?? new Date().toISOString().slice(0, 10)}`,
      `Καθαρή Αξία: ${fmt(opts.netCents)}`,
      `ΦΠΑ 24%: ${fmt(opts.vatCents)}`,
      `Σύνολο: ${fmt(opts.totalCents)}`,
      `Ευχαριστούμε για τη συνεργασία!`,
    ].join('\n');
  }
}
