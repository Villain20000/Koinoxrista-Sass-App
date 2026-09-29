import { formatEuros, escapeHtml } from '../reminders/reminder-emails';

export interface ReceiptPaymentInput {
  createdAt?: Date | string;
  method: string;
  pspRef?: string | null;
  amountCents: number;
}

export interface ReceiptInput {
  buildingName: string;
  unitLabel: string;
  periodYearMonth: string;
  totalCents: number;
  paidCents: number;
  payments: ReceiptPaymentInput[];
  generatedAt: Date;
}

const METHOD_GREEK: Record<string, string> = {
  CARD: 'Κάρτα',
  IRIS: 'IRIS',
};

const TD = 'padding:6px 12px;border-bottom:1px solid #e5e7eb;';

/** Minimal printable Greek HTML receipt with inline styles and € amounts. */
export function renderReceiptHtml(input: ReceiptInput): string {
  const balanceCents = input.totalCents - input.paidCents;
  const paymentRows =
    input.payments.length === 0
      ? `<tr><td colspan="4" style="${TD}">— καμία καταγραφή πληρωμής —</td></tr>`
      : input.payments
          .map((payment) => {
            const date =
              typeof payment.createdAt === 'string'
                ? payment.createdAt
                : (payment.createdAt?.toISOString().slice(0, 10) ?? '—');
            return `
        <tr>
          <td style="${TD}">${escapeHtml(date)}</td>
          <td style="${TD}">${escapeHtml(METHOD_GREEK[payment.method] ?? payment.method)}</td>
          <td style="${TD};text-align:right;">${formatEuros(payment.amountCents)}</td>
          <td style="${TD}">${escapeHtml(payment.pspRef ?? '—')}</td>
        </tr>`;
          })
          .join('');

  return `<!DOCTYPE html>
<html lang="el">
  <head><meta charset="utf-8" /><title>Απόδειξη κοινόχρηστων ${escapeHtml(input.periodYearMonth)}</title></head>
  <body style="margin:0;background:#f9fafb;font-family:Georgia,'Times New Roman',serif;color:#111827;">
    <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #d1d5db;border-radius:8px;padding:32px;">
      <h1 style="margin:0 0 4px;font-size:20px;">Απόδειξη κοινόχρηστων εξόδων</h1>
      <p style="margin:0 0 20px;color:#6b7280;font-size:13px;">${escapeHtml(input.buildingName)} — εκδόθηκε ${escapeHtml(input.generatedAt.toISOString().slice(0, 10))}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
        <tr><td style="${TD};font-weight:bold;">Διαμέρισμα</td><td style="${TD}">${escapeHtml(input.unitLabel)}</td></tr>
        <tr><td style="${TD};font-weight:bold;">Περίοδος</td><td style="${TD}">${escapeHtml(input.periodYearMonth)}</td></tr>
        <tr><td style="${TD};font-weight:bold;">Συνολικό ποσό</td><td style="${TD}">${formatEuros(input.totalCents)}</td></tr>
        <tr><td style="${TD};font-weight:bold;">Εξοφλημένα</td><td style="${TD}">${formatEuros(input.paidCents)}</td></tr>
        <tr><td style="${TD};font-weight:bold;">Υπόλοιπο</td><td style="${TD};font-weight:bold;">${formatEuros(balanceCents)}</td></tr>
      </table>
      <h2 style="margin:0 0 8px;font-size:15px;">Πληρωμές</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th align="left" style="padding:6px 12px;border-bottom:2px solid #111827;">Ημερομηνία</th>
            <th align="left" style="padding:6px 12px;border-bottom:2px solid #111827;">Τρόπος</th>
            <th align="right" style="padding:6px 12px;border-bottom:2px solid #111827;">Ποσό</th>
            <th align="left" style="padding:6px 12px;border-bottom:2px solid #111827;">Αναφορά</th>
          </tr>
        </thead>
        <tbody>${paymentRows}
        </tbody>
      </table>
    </div>
  </body>
</html>`;
}
