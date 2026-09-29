import {
  createBankFeedAdapter,
  OfflineBankFeedAdapter,
  resolveOpenBankingMode,
  type BankConnectionRef,
} from './openbanking.adapter';
import {
  FeedFetchError,
  GoCardlessAdapter,
  NotConfiguredError,
} from './openbanking.gocardless';

const conn = (iban = 'GR1601101250000000012300695'): BankConnectionRef => ({
  id: 'conn-1',
  buildingId: 'building-1',
  institutionName: 'Τράπεζα',
  iban,
  mode: 'offline',
});

describe('OfflineBankFeedAdapter', () => {
  const adapter = new OfflineBankFeedAdapter();

  it('generates the same transactions for the same iban + window', async () => {
    const first = await adapter.listTransactions(conn(), '2026-07-01', '2026-07-14');
    const second = await new OfflineBankFeedAdapter().listTransactions(
      conn(),
      '2026-07-01',
      '2026-07-14',
    );
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first.map((tx) => tx.externalId)).size).toBe(first.length);
  });

  it('seeds by iban — a different connection yields a different feed', async () => {
    const other = await adapter.listTransactions(
      conn('GR9608101010000000123456789'),
      '2026-07-01',
      '2026-07-14',
    );
    const base = await adapter.listTransactions(conn(), '2026-07-01', '2026-07-14');
    expect(other).not.toEqual(base);
  });

  it('keeps externalIds stable across overlapping windows so re-syncs dedupe', async () => {
    const wide = await adapter.listTransactions(conn(), '2026-07-01', '2026-07-31');
    const overlap = await adapter.listTransactions(conn(), '2026-07-20', '2026-08-10');
    const wideIds = new Set(wide.map((tx) => tx.externalId));
    const julyOverlap = overlap.filter(
      (tx) => tx.bookedAt.toISOString().slice(0, 7) === '2026-07',
    );
    expect(julyOverlap.length).toBeGreaterThan(0);
    for (const tx of julyOverlap) {
      expect(wideIds.has(tx.externalId)).toBe(true);
    }
  });

  it('books every transaction inside the requested window at noon UTC', async () => {
    const txs = await adapter.listTransactions(conn(), '2026-07-01', '2026-07-05');
    for (const tx of txs) {
      expect(tx.bookedAt.getTime()).toBeGreaterThanOrEqual(
        Date.parse('2026-07-01T00:00:00Z'),
      );
      expect(tx.bookedAt.getTime()).toBeLessThanOrEqual(
        Date.parse('2026-07-05T23:59:59Z'),
      );
      expect(tx.bookedAt.getUTCHours()).toBe(12);
      expect(tx.remittanceInfo).toBeTruthy();
    }
  });

  it('returns no rows for an inverted or invalid window', async () => {
    await expect(
      adapter.listTransactions(conn(), '2026-07-10', '2026-07-01'),
    ).resolves.toEqual([]);
    await expect(
      adapter.listTransactions(conn(), 'not-a-date', '2026-07-01'),
    ).resolves.toEqual([]);
  });
});

describe('createBankFeedAdapter / resolveOpenBankingMode', () => {
  const envKeys = ['OPENBANKING_MODE', 'GC_SECRET_ID', 'GC_SECRET_KEY'] as const;

  afterEach(() => {
    for (const key of envKeys) delete process.env[key];
  });

  it('defaults to offline and honors offline mode', () => {
    expect(createBankFeedAdapter()).toBeInstanceOf(OfflineBankFeedAdapter);
    expect(createBankFeedAdapter('offline')).toBeInstanceOf(
      OfflineBankFeedAdapter,
    );
    expect(resolveOpenBankingMode()).toBe('offline');
  });

  it('gocardless mode fails fast without credentials', () => {
    process.env.OPENBANKING_MODE = 'gocardless';
    expect(() => createBankFeedAdapter()).toThrow(NotConfiguredError);
    process.env.GC_SECRET_ID = 'id';
    expect(() => createBankFeedAdapter()).toThrow(/GC_SECRET_KEY/);
  });

  it('gocardless mode builds a live client once credentials are present', () => {
    process.env.OPENBANKING_MODE = 'gocardless';
    process.env.GC_SECRET_ID = 'id';
    process.env.GC_SECRET_KEY = 'key';
    expect(createBankFeedAdapter()).toBeInstanceOf(GoCardlessAdapter);
    expect(resolveOpenBankingMode()).toBe('gocardless');
  });
});

describe('GoCardlessAdapter', () => {
  const config = { secretId: 'id', secretKey: 'key' };

  function fetchJson(body: unknown, ok = true): jest.Mock {
    return jest.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 503,
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }

  it('throws NotConfiguredError without secret id/key', () => {
    delete process.env.GC_SECRET_ID;
    delete process.env.GC_SECRET_KEY;
    expect(() => new GoCardlessAdapter()).toThrow(NotConfiguredError);
    expect(
      () =>
        new GoCardlessAdapter({
          ...config,
          secretKey: undefined,
        } as never),
    ).toThrow(/GC_SECRET_KEY/);
  });

  it('maps booked transactions into raw rows via /api/v2/transactions/', async () => {
    const fetchFn = fetchJson({
      transactions: {
        booked: [
          {
            transactionId: 'TX-1',
            bookingDate: '2026-07-03',
            transactionAmount: { amount: '85.50' },
            remittanceInformationUnstructured: 'ΣΥΝΔΡΟΜΗ Α1',
          },
          {
            entryReference: 'ENTRY-2',
            bookingDate: '2026-07-04',
            transactionAmount: { amount: '-40.00' },
          },
          { transactionAmount: { amount: '1.00' }, bookingDate: '2026-07-05' },
        ],
      },
    });
    const adapter = new GoCardlessAdapter({ ...config, fetchFn });

    await expect(
      adapter.listTransactions(conn(), '2026-07-01', '2026-07-31'),
    ).resolves.toEqual([
      {
        externalId: 'TX-1',
        bookedAt: new Date(Date.parse('2026-07-03T12:00:00Z')),
        amountCents: 8_550,
        remittanceInfo: 'ΣΥΝΔΡΟΜΗ Α1',
      },
      {
        externalId: 'ENTRY-2',
        bookedAt: new Date(Date.parse('2026-07-04T12:00:00Z')),
        amountCents: -4_000,
      },
    ]);

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v2/transactions/');
    expect(url).toContain('iban=GR1601101250000000012300695');
    const headers = init.headers as Record<string, string>;
    expect(headers['Secret-Id']).toBe('id');
    expect(headers['Secret-Key']).toBe('key');
  });

  it('wraps network and non-2xx failures in FeedFetchError', async () => {
    const failing = jest
      .fn()
      .mockRejectedValue(new Error('offline'));
    await expect(
      new GoCardlessAdapter({ ...config, fetchFn: failing }).listTransactions(
        conn(),
        '2026-07-01',
        '2026-07-31',
      ),
    ).rejects.toThrow(FeedFetchError);

    const serverError = fetchJson({}, false);
    await expect(
      new GoCardlessAdapter({ ...config, fetchFn: serverError }).listTransactions(
        conn(),
        '2026-07-01',
        '2026-07-31',
      ),
    ).rejects.toThrow(/\(503\)/);
  });
});
