import { buildMyDataXml, escapeXml, MyDataXmlRecord } from './mydata.xml';

const record = (overrides: Partial<MyDataXmlRecord> = {}): MyDataXmlRecord => ({
  mark: '4000ABCDEF123456',
  series: 'A',
  seqNo: 1,
  issueDate: new Date('2026-08-24T09:30:00.000Z'),
  paymentMethodCode: '3',
  classificationCategory: 'category1_1',
  classificationType: 'E3_561_001',
  netAmountCents: 10_000,
  vatAmountCents: 2_400,
  ...overrides,
});

describe('escapeXml', () => {
  it('escapes all XML-sensitive characters', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeXml('Κοινόχρηστα 2026')).toBe('Κοινόχρηστα 2026');
  });
});

describe('buildMyDataXml', () => {
  it('renders one invoice element per record inside InvoicesDoc', () => {
    const xml = buildMyDataXml([
      record(),
      record({ mark: '4000FFFFFFFFFFFF', seqNo: 2, paymentMethodCode: '9' }),
    ]);

    expect(xml).toContain('<InvoicesDoc>');
    expect(xml.match(/<invoice>/g)).toHaveLength(2);
    expect(xml).toContain('<series>A</series>');
    expect(xml).toContain('<aa>2</aa>');
    expect(xml).toContain('<issueDate>2026-08-24</issueDate>');
    expect(xml).toContain('<mark>4000ABCDEF123456</mark>');
    expect(xml).toContain('<paymentMethod>9</paymentMethod>');
    expect(xml).toContain('<netValue>100.00</netValue>');
    expect(xml).toContain('<vatAmount>24.00</vatAmount>');
    expect(xml).toContain(
      '<classificationType>E3_561_001</classificationType>',
    );
  });

  it('escapes hostile field values', () => {
    const xml = buildMyDataXml([record({ series: 'A&B<1>' })]);

    expect(xml).toContain('<series>A&amp;B&lt;1&gt;</series>');
    expect(xml).not.toContain('A&B');
  });

  it('is deterministic for the same input', () => {
    const records = [record(), record({ seqNo: 2 })];
    expect(buildMyDataXml(records)).toBe(buildMyDataXml(records));
  });
});
