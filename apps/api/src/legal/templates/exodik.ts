/** Greek exodik (εξώδικο) HTML template — minimal printable, inline styles. */

export interface ExodikInvoiceRow {
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
}

export interface ExodikInput {
  buildingName: string;
  buildingAddress: string;
  buildingCity?: string;
  unitLabel: string;
  title: string;
  totalCents: number;
  invoices: ExodikInvoiceRow[];
  deadline: Date;
  generatedAt: Date;
  lawyerName?: string | null;
  lawyerEmail?: string | null;
  notes?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatEuros(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString();
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${grouped},${frac} €`;
}

function formatDateGr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const TD = 'padding:6px 12px;border-bottom:1px solid #e5e7eb;';
const TH = 'padding:6px 12px;border-bottom:2px solid #111827;text-align:left;';

/**
 * Renders a printable Greek exodik notice.
 * - building address, unit label, arrears table, total, deadline 15 days.
 */
export function renderExodikHtml(input: ExodikInput): string {
  const invoiceRows =
    input.invoices.length === 0
      ? `<tr><td colspan="4" style="${TD}">— καμία οφειλή —</td></tr>`
      : [...input.invoices]
          .sort((a, b) => (a.periodYearMonth < b.periodYearMonth ? -1 : a.periodYearMonth > b.periodYearMonth ? 1 : 0))
          .map(
            (inv) => `
        <tr>
          <td style="${TD}">${escapeHtml(inv.periodYearMonth)}</td>
          <td style="${TD};text-align:right;">${formatEuros(inv.totalCents)}</td>
          <td style="${TD};text-align:right;">${formatEuros(inv.paidCents)}</td>
          <td style="${TD};text-align:right;font-weight:bold;">${formatEuros(inv.outstandingCents)}</td>
        </tr>`,
          )
          .join('');

  const deadlineStr = formatDateGr(input.deadline);
  const generatedStr = formatDateGr(input.generatedAt);
  const city = input.buildingCity ? `, ${escapeHtml(input.buildingCity)}` : '';
  const lawyerBlock = input.lawyerName
    ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;"><strong>Δικηγόρος:</strong> ${escapeHtml(input.lawyerName)}${input.lawyerEmail ? ` — ${escapeHtml(input.lawyerEmail)}` : ''}</p>`
    : '';

  const notesBlock = input.notes
    ? `<div style="margin-top:16px;padding:12px;background:#fef9c3;border:1px solid #fde047;border-radius:6px;font-size:13px;"><strong>Σημειώσεις:</strong> ${escapeHtml(input.notes)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="el">
  <head><meta charset="utf-8" /><title>Εξώδικο — ${escapeHtml(input.unitLabel)} — ${escapeHtml(generatedStr)}</title></head>
  <body style="margin:0;background:#f9fafb;font-family:Georgia,'Times New Roman',serif;color:#111827;">
    <div style="max-width:640px;margin:24px auto;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;padding:32px;">
      <div style="text-align:center;border-bottom:2px solid #1e3a8a;padding-bottom:16px;margin-bottom:20px;">
        <h1 style="margin:0;font-size:22px;color:#1e3a8a;">ΕΞΩΔΙΚΗ ΔΗΛΩΣΗ — ΠΡΟΣΚΛΗΣΗ — ΔΙΑΜΑΡΤΥΡΙΑ</h1>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Κατά το άρθρο 171 ΚΠολΔ — με επιφύλαξη παντός νομίμου δικαιώματος</p>
      </div>

      <div style="margin-bottom:16px;font-size:13px;color:#4b5563;">
        <p style="margin:0;"><strong>Πολυκατοικία:</strong> ${escapeHtml(input.buildingName)}</p>
        <p style="margin:2px 0 0;"><strong>Διεύθυνση:</strong> ${escapeHtml(input.buildingAddress)}${city}</p>
        <p style="margin:2px 0 0;"><strong>Διαμέρισμα:</strong> ${escapeHtml(input.unitLabel)}</p>
        <p style="margin:2px 0 0;"><strong>Ημερομηνία:</strong> ${escapeHtml(generatedStr)} &nbsp;|&nbsp; <strong>Υπόθεση:</strong> ${escapeHtml(input.title)}</p>
        ${lawyerBlock}
      </div>

      <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px 16px;margin-bottom:16px;font-size:13px;">
        <p style="margin:0;"><strong>ΚΑΛΕΙΣΘΕ</strong> όπως εντός <strong>δέκα πέντε (15) ημερών</strong> από την παραλαβή της παρούσης, ήτοι το αργότερο έως <strong>${escapeHtml(deadlineStr)}</strong>, εξοφλήσετε το κατωτέρω αναλυόμενο συνολικό ανεξόφλητο ποσό κοινόχρηστων δαπανών, άλλως επιφυλασσόμεθα για την άσκηση κάθε νομίμου μέσου, συμπεριλαμβανομένης της αιτήσεως εκδόσεως <strong>διαταγής πληρωμής</strong> (άρθ. 623 επ. ΚΠολΔ).</p>
      </div>

      <h2 style="margin:0 0 8px;font-size:15px;">Αναλυτική κατάσταση οφειλών</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr>
            <th style="${TH}">Περίοδος</th>
            <th style="${TH};text-align:right;">Βεβαιωθέν</th>
            <th style="${TH};text-align:right;">Καταβληθέν</th>
            <th style="${TH};text-align:right;">Υπόλοιπο</th>
          </tr>
        </thead>
        <tbody>${invoiceRows}
          <tr style="background:#f3f4f6;">
            <td colspan="3" style="padding:8px 12px;text-align:right;font-weight:bold;">Σύνολο οφειλής</td>
            <td style="padding:8px 12px;text-align:right;font-weight:bold;color:#b91c1c;">${formatEuros(input.totalCents)}</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:16px;padding:12px;border:1px dashed #9ca3af;border-radius:6px;font-size:12px;color:#4b5563;">
        <p style="margin:0;"><strong>Τρόπος εξόφλησης:</strong> Κατάθεση στον τραπεζικό λογαριασμό της πολυκατοικίας ή μέσω της πλατφόρμας PolykatoikiaOS. Παρακαλείσθε όπως αποστείλετε αποδεικτικό καταβολής.</p>
        <p style="margin:6px 0 0;"><strong>Προθεσμία συμμόρφωσης:</strong> ${escapeHtml(deadlineStr)} (15 ημέρες).</p>
      </div>

      ${notesBlock}

      <div style="margin-top:24px;display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#374151;">
        <div style="flex:1;">
          <p style="margin:0;">Για τη Διαχείριση</p>
          <div style="margin-top:32px;border-top:1px solid #111827;width:180px;padding-top:4px;">Υπογραφή / Σφραγίδα</div>
        </div>
        <div style="flex:1;text-align:right;">
          <p style="margin:0;">Για τον/την οφειλέτη/τρια</p>
          <div style="margin-top:32px;border-top:1px solid #111827;width:180px;margin-left:auto;padding-top:4px;">Παραλαβή — Υπογραφή</div>
        </div>
      </div>

      <p style="margin:20px 0 0;font-size:10px;color:#9ca3af;text-align:center;">Το παρόν παράχθηκε αυτομάτως από το PolykatoikiaOS — ${escapeHtml(generatedStr)} — Εμπιστευτικό έγγραφο διαχείρισης.</p>
    </div>
  </body>
</html>`;
}

export { escapeHtml, formatEuros };
