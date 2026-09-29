import { renderReceiptHtml } from './render-receipt';

const input = {
  buildingName: 'Κτίριο «Ηλέκτρα»',
  unitLabel: 'Α1',
  periodYearMonth: '2026-07',
  totalCents: 10_000,
  paidCents: 6_500,
  payments: [
    {
      createdAt: new Date('2026-07-21T09:00:00.000Z'),
      method: 'CARD',
      pspRef: 'OC-123',
      amountCents: 6_000,
    },
    { method: 'IRIS', pspRef: null, amountCents: 500 },
  ],
  generatedAt: new Date('2026-08-24T12:00:00.000Z'),
};

describe('renderReceiptHtml', () => {
  const html = renderReceiptHtml(input);

  it('renders a standalone Greek HTML document with inline styles', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="el">');
    expect(html).toContain('style=');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('class=');
  });

  it('shows building, unit, period and € amounts including the balance', () => {
    expect(html).toContain('Κτίριο «Ηλέκτρα»');
    expect(html).toContain('Α1');
    expect(html).toContain('2026-07');
    expect(html).toContain('100,00 €');
    expect(html).toContain('65,00 €');
    expect(html).toContain('Υπόλοιπο');
    expect(html).toContain('35,00 €');
  });

  it('lists every payment with method and reference', () => {
    expect(html).toContain('Κάρτα');
    expect(html).toContain('IRIS');
    expect(html).toContain('OC-123');
    expect(html).toContain('2026-07-21');
    expect(html).toContain('60,00 €');
    expect(html).toContain('5,00 €');
  });

  it('renders an empty-state row when no payments exist', () => {
    const empty = renderReceiptHtml({ ...input, payments: [] });
    expect(empty).toContain('καμία καταγραφή πληρωμής');
  });
});
