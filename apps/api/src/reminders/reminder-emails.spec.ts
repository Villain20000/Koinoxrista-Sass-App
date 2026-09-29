import {
  buildReminderHtml,
  buildReminderSubject,
  escapeHtml,
  formatEuros,
} from './reminder-emails';

describe('formatEuros', () => {
  it('formats cents as Greek euro amounts', () => {
    expect(formatEuros(0)).toBe('0,00 €');
    expect(formatEuros(5)).toBe('0,05 €');
    expect(formatEuros(12_345)).toBe('123,45 €');
    expect(formatEuros(1_234_567)).toBe('12.345,67 €');
    expect(formatEuros(-950)).toBe('-9,50 €');
  });
});

describe('escapeHtml', () => {
  it('escapes markup-significant characters', () => {
    expect(escapeHtml('<b>"x"&</b>')).toBe('&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;');
  });
});

describe('buildReminderSubject', () => {
  it('mentions the period when provided', () => {
    expect(buildReminderSubject()).toBe('Υπενθύμιση οφειλών κοινόχρηστων');
    expect(buildReminderSubject('2026-07')).toBe(
      'Υπενθύμιση οφειλών κοινόχρηστων — περίοδος 2026-07',
    );
  });
});

describe('buildReminderHtml', () => {
  const url = 'http://localhost:4200/balance';

  it('lists every unpaid period with its amount and the balance link', () => {
    const html = buildReminderHtml(
      [
        { unitLabel: 'Β1', periodYearMonth: '2026-07', outstandingCents: 4_200 },
        { unitLabel: 'Α1', periodYearMonth: '2026-08', outstandingCents: 1_000 },
      ],
      url,
    );

    expect(html).toContain('Διαμ. Β1');
    expect(html).toContain('Διαμ. Α1');
    expect(html).toContain('2026-07');
    expect(html).toContain('42,00 €');
    expect(html).toContain('10,00 €');
    expect(html).toContain('Σύνολο οφειλής');
    expect(html).toContain('52,00 €');
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(url);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('sorts line items by period ascending', () => {
    const html = buildReminderHtml(
      [
        { unitLabel: 'Α1', periodYearMonth: '2026-08', outstandingCents: 100 },
        { unitLabel: 'Α1', periodYearMonth: '2026-05', outstandingCents: 200 },
      ],
      url,
    );

    expect(html.indexOf('2026-05')).toBeLessThan(html.indexOf('2026-08'));
  });

  it('escapes untrusted values inside the HTML', () => {
    const html = buildReminderHtml(
      [{ unitLabel: '<script>x</script>', periodYearMonth: '2026-07', outstandingCents: 100 }],
      url,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
