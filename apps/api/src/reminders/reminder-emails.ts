export interface ReminderLineItem {
  unitLabel: string;
  periodYearMonth: string;
  outstandingCents: number;
}

/** Greek euro amount from cents: 123456 → "1.234,56 €". */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toString();
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${grouped},${frac} €`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildReminderSubject(periodYearMonth?: string): string {
  return periodYearMonth
    ? `Υπενθύμιση οφειλών κοινόχρηστων — περίοδος ${periodYearMonth}`
    : 'Υπενθύμιση οφειλών κοινόχρηστων';
}

export function buildReminderHtml(
  items: ReminderLineItem[],
  balanceUrl: string,
): string {
  const sorted = [...items].sort((a, b) =>
    a.periodYearMonth < b.periodYearMonth
      ? -1
      : a.periodYearMonth > b.periodYearMonth
        ? 1
        : a.unitLabel < b.unitLabel
          ? -1
          : 1,
  );
  const total = sorted.reduce((sum, item) => sum + item.outstandingCents, 0);
  const rows = sorted
    .map(
      (item) => `
      <tr>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">Διαμ. ${escapeHtml(item.unitLabel)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.periodYearMonth)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatEuros(item.outstandingCents)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="el">
  <body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:8px;padding:24px;">
      <h2 style="margin:0 0 12px;">Υπενθύμιση οφειλών κοινόχρηστων</h2>
      <p style="margin:0 0 16px;">Αγαπητέ ιδιοκτήτη/διαμένοντα,<br />
      σας υπενθυμούμε τις εκκρεμείς οφειλές σας για κοινόχρηστα έξοδα:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr>
            <th align="left" style="padding:6px 12px;border-bottom:2px solid #111827;">Διαμέρισμα</th>
            <th align="left" style="padding:6px 12px;border-bottom:2px solid #111827;">Περίοδος</th>
            <th align="right" style="padding:6px 12px;border-bottom:2px solid #111827;">Ποσό</th>
          </tr>
        </thead>
        <tbody>${rows}
          <tr>
            <td colspan="2" style="padding:8px 12px;text-align:right;font-weight:bold;">Σύνολο οφειλής</td>
            <td style="padding:8px 12px;text-align:right;font-weight:bold;">${formatEuros(total)}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin:20px 0 0;">
        <a href="${escapeHtml(balanceUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;">Εξόφληση online</a>
      </p>
      <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">
        Μπορείτε να εξοφλήσετε στο ${escapeHtml(balanceUrl)}
      </p>
    </div>
  </body>
</html>`;
}
