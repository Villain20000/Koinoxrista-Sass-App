/** One myDATA record rendered into the XML export. */
export interface MyDataXmlRecord {
  mark: string;
  series: string;
  seqNo: number;
  issueDate: Date;
  paymentMethodCode: string;
  classificationCategory: string;
  classificationType: string;
  netAmountCents: number;
  vatAmountCents: number;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

function centsToEur(cents: number): string {
  return (cents / 100).toFixed(2);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic, namespace-light myDATA invoice document. */
export function buildMyDataXml(records: readonly MyDataXmlRecord[]): string {
  const invoices = [...records]
    .sort((a, b) => a.seqNo - b.seqNo || a.mark.localeCompare(b.mark))
    .map((record) =>
      [
        '  <invoice>',
        `    <series>${escapeXml(record.series)}</series>`,
        `    <aa>${record.seqNo}</aa>`,
        `    <issueDate>${isoDay(record.issueDate)}</issueDate>`,
        `    <mark>${escapeXml(record.mark)}</mark>`,
        `    <paymentMethod>${escapeXml(record.paymentMethodCode)}</paymentMethod>`,
        '    <invoiceDetails>',
        '      <lineNumber>1</lineNumber>',
        `      <netValue>${centsToEur(record.netAmountCents)}</netValue>`,
        `      <vatAmount>${centsToEur(record.vatAmountCents)}</vatAmount>`,
        '      <classifications>',
        `        <classificationCategory>${escapeXml(record.classificationCategory)}</classificationCategory>`,
        `        <classificationType>${escapeXml(record.classificationType)}</classificationType>`,
        '      </classifications>',
        '    </invoiceDetails>',
        '  </invoice>',
      ].join('\n'),
    );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<InvoicesDoc>',
    ...invoices,
    '</InvoicesDoc>',
    '',
  ].join('\n');
}
