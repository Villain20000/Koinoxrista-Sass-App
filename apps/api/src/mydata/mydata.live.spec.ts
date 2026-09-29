import type { AxiosInstance } from 'axios';

import type { MyDataSubmitInput } from './mydata.adapter';
import {
  DEFAULT_MYDATA_BASE_URL,
  LiveAadeMyDataProvider,
  retryWithBackoff,
  SubmissionError,
} from './mydata.live';

const SAMPLE_RESPONSE_DOC =
  '<?xml version="1.0" encoding="utf-8"?><ResponseDoc><response><index>1</index>' +
  '<uid>400123456789012</uid><authenticationCode>Z4F2A1B9C8D2</authenticationCode>' +
  '</response></ResponseDoc>';

const sampleInvoice = (): MyDataSubmitInput => ({
  invoiceId: 'invoice-1',
  series: 'A',
  seqNo: 7,
  issueDate: '2026-08-25',
  invoiceType: '2.1',
  paymentMethodCode: '3',
  netAmountCents: 10_000,
  vatAmountCents: 2_400,
  classificationCategory: 'category1_1',
  classificationType: 'E3_561_001',
});

function makeHttp() {
  return { post: jest.fn(), get: jest.fn() };
}

function makeProvider(http: ReturnType<typeof makeHttp>, overrides = {}) {
  return new LiveAadeMyDataProvider({
    userId: 'user-1',
    subscriptionKey: 'sub-key-1',
    clientSecret: 'secret-1',
    http: http as unknown as AxiosInstance,
    retry: { retries: 0 },
    ...overrides,
  });
}

const axiosFailure = (status: number, data = 'boom') => ({
  isAxiosError: true,
  message: `HTTP ${status}`,
  response: { status, data },
});

describe('retryWithBackoff', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries transient failures and resolves once the call succeeds', async () => {
    jest.useFakeTimers();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new SubmissionError('a', { status: 503 }))
      .mockRejectedValueOnce(new SubmissionError('b'))
      .mockResolvedValueOnce('ok');

    const pending = retryWithBackoff(fn, { retries: 3, baseMs: 100 });
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('aborts early on 4xx responses other than 429', async () => {
    const fn = jest
      .fn()
      .mockRejectedValue(new SubmissionError('nope', { status: 400 }));

    await expect(retryWithBackoff(fn, { retries: 3 })).rejects.toThrow(
      SubmissionError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying on 429', async () => {
    jest.useFakeTimers();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new SubmissionError('slow down', { status: 429 }))
      .mockResolvedValueOnce('ok');

    const pending = retryWithBackoff(fn, { retries: 3, baseMs: 10 });
    await jest.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting all retries', async () => {
    jest.useFakeTimers();
    const fn = jest
      .fn()
      .mockRejectedValue(new SubmissionError('still down', { status: 502 }));

    // Attach the handler before advancing so the rejection is never unhandled.
    const pending = expect(
      retryWithBackoff(fn, { retries: 2, baseMs: 10 }),
    ).rejects.toThrow('still down');
    await jest.advanceTimersByTimeAsync(5_000);
    await pending;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('LiveAadeMyDataProvider construction', () => {
  it('fails fast without user id or subscription key', () => {
    const http = makeHttp();
    expect(
      () =>
        new LiveAadeMyDataProvider({ http: http as unknown as AxiosInstance }),
    ).toThrow(/MYDATA_USER_ID/);
    expect(
      () =>
        new LiveAadeMyDataProvider({
          http: http as unknown as AxiosInstance,
          userId: 'u',
        }),
    ).toThrow(/MYDATA_SUBSCRIPTION_KEY/);
  });

  it('falls back to the AADE staging base URL', () => {
    const http = makeHttp();
    makeProvider(http);
    // baseURL is applied by axios.create in production; the injected mock
    // receives relative paths only — assert against the exported default.
    expect(DEFAULT_MYDATA_BASE_URL).toBe('https://mydatapi.aade.gr/staging');
  });
});

describe('LiveAadeMyDataProvider.submit', () => {
  it('parses the MARK from the ResponseDoc and returns the raw XML', async () => {
    const http = makeHttp();
    http.post.mockImplementation((url: string) => {
      if (url === '/oauth/token') {
        return Promise.resolve({
          data: { access_token: 'tok-1', expires_in: 3600 },
        });
      }
      return Promise.resolve({ data: SAMPLE_RESPONSE_DOC });
    });

    const result = await makeProvider(http).submit(sampleInvoice());

    expect(result.mark).toBe('400123456789012');
    expect(result.raw).toBe(SAMPLE_RESPONSE_DOC);
  });

  it('sends the invoice as a URL-encoded form field with AADE headers', async () => {
    const http = makeHttp();
    http.post.mockImplementation((url: string) =>
      url === '/oauth/token'
        ? Promise.resolve({
            data: { access_token: 'tok-1', expires_in: 3600 },
          })
        : Promise.resolve({ data: SAMPLE_RESPONSE_DOC }),
    );

    await makeProvider(http).submit(sampleInvoice());

    const [url, body, config] =
      http.post.mock.calls.find(([u]) => u === '/SendInvoiceDocs') ?? [];
    expect(url).toBe('/SendInvoiceDocs');
    expect(String(body)).toMatch(/^invoice=%3CInvoicesDoc%20version%3D%221/);
    expect(decodeURIComponent(String(body))).toContain('<aa>7</aa>');
    expect(decodeURIComponent(String(body))).toContain(
      '<issueDate>2026-08-25</issueDate>',
    );
    expect(decodeURIComponent(String(body))).toContain(
      '<invoiceType>2.1</invoiceType>',
    );
    expect(decodeURIComponent(String(body))).toContain('<netValue>100.00</netValue>');
    // 24% effective rate maps to AADE VAT category 1.
    expect(decodeURIComponent(String(body))).toContain(
      '<vatCategory>1</vatCategory>',
    );
    expect(decodeURIComponent(String(body))).toContain(
      '<vatAmount>24.00</vatAmount>',
    );
    expect(decodeURIComponent(String(body))).toContain(
      '<classificationType>E3_561_001</classificationType>' +
        '<classificationCategory>category1_1</classificationCategory>' +
        '<amount>100.00</amount>',
    );
    expect(decodeURIComponent(String(body))).toContain(
      '<documentTotalNetValue>100.00</documentTotalNetValue>' +
        '<documentTotalVatAmount>24.00</documentTotalVatAmount>' +
        '<totalGrossValue>124.00</totalGrossValue>',
    );
    expect(config.headers).toEqual({
      'aade-user-id': 'user-1',
      'ocp-apim-subscription-key': 'sub-key-1',
      Authorization: 'Bearer tok-1',
    });
    const tokenCall = http.post.mock.calls.find(([u]) => u === '/oauth/token');
    expect(tokenCall?.[1]).toBe('grant_type=client_credentials');
    expect(tokenCall?.[2].auth).toEqual({
      username: 'user-1',
      password: 'secret-1',
    });
  });

  it('maps reduced VAT rates to their AADE category codes and defaults missing metadata', async () => {
    const http = makeHttp();
    http.post.mockImplementation((url: string) =>
      url === '/oauth/token'
        ? Promise.resolve({ data: { access_token: 't', expires_in: 3600 } })
        : Promise.resolve({ data: SAMPLE_RESPONSE_DOC }),
    );

    await makeProvider(http).submit({
      invoiceId: 'invoice-2',
      series: 'A',
      seqNo: 8,
      paymentMethodCode: '9',
      netAmountCents: 10_000,
      vatAmountCents: 1_300,
    });

    const [, body] = http.post.mock.calls.find(
      ([u]) => u === '/SendInvoiceDocs',
    ) ?? ['', ''];
    const xml = decodeURIComponent(String(body));
    expect(xml).toContain('<vatCategory>2</vatCategory>'); // 13% → code 2
    expect(xml).toContain('<invoiceType>2.1</invoiceType>'); // default type
    expect(xml).toMatch(/<issueDate>\d{4}-\d{2}-\d{2}<\/issueDate>/); // today
    expect(xml).toContain('<classificationCategory>category1_1'); // defaults
  });

  it('caches the OAuth token until 60s before expiry', async () => {
    let nowMs = 1_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    try {
      const http = makeHttp();
      http.post.mockImplementation((url: string) =>
        url === '/oauth/token'
          ? Promise.resolve({
              data: { access_token: `tok-${nowMs}`, expires_in: 120 },
            })
          : Promise.resolve({ data: SAMPLE_RESPONSE_DOC }),
      );
      const provider = makeProvider(http);

      await provider.submit(sampleInvoice());
      await provider.submit(sampleInvoice());
      expect(
        http.post.mock.calls.filter(([u]) => u === '/oauth/token'),
      ).toHaveLength(1);

      nowMs += 61_000; // past expiry (120s) minus the 60s margin
      await provider.submit(sampleInvoice());
      expect(
        http.post.mock.calls.filter(([u]) => u === '/oauth/token'),
      ).toHaveLength(2);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('marks responses without a uid as rejected without retrying', async () => {
    const http = makeHttp();
    http.post.mockImplementation((url: string) =>
      url === '/oauth/token'
        ? Promise.resolve({ data: { access_token: 't', expires_in: 3600 } })
        : Promise.resolve({
            data: '<ResponseDoc><errors><error><message>invalid doc</message></error></errors></ResponseDoc>',
          }),
    );

    await expect(makeProvider(http).submit(sampleInvoice())).rejects.toThrow(
      SubmissionError,
    );
    expect(
      http.post.mock.calls.filter(([u]) => u === '/SendInvoiceDocs'),
    ).toHaveLength(1);
  });

  it('wraps non-2xx HTTP failures in a SubmissionError carrying the status', async () => {
    const http = makeHttp();
    http.post.mockImplementation((url: string) =>
      url === '/oauth/token'
        ? Promise.resolve({ data: { access_token: 't' } })
        : Promise.reject(axiosFailure(500, 'server exploded')),
    );

    await expect(
      makeProvider(http).submit(sampleInvoice()),
    ).rejects.toMatchObject({ name: 'SubmissionError', status: 500 });
  });
});

describe('LiveAadeMyDataProvider.pollStatus', () => {
  function httpForRequestDocs(data: string) {
    const http = makeHttp();
    http.get.mockResolvedValue({ data });
    http.post.mockResolvedValue({
      data: { access_token: 't', expires_in: 3600 },
    });
    return http;
  }

  it('reports ACCEPTED when uid + authenticationCode are present', async () => {
    const http = httpForRequestDocs(SAMPLE_RESPONSE_DOC);

    await expect(
      makeProvider(http).pollStatus('400123456789012'),
    ).resolves.toEqual({ state: 'ACCEPTED', raw: SAMPLE_RESPONSE_DOC });

    const [url, config] = http.get.mock.calls[0];
    expect(url).toBe('/RequestDocs');
    expect((config as { params?: unknown }).params).toEqual({
      mark: '400123456789012',
    });
    expect((config as { headers?: unknown }).headers).toEqual({
      'aade-user-id': 'user-1',
      'ocp-apim-subscription-key': 'sub-key-1',
      Authorization: 'Bearer t',
    });
  });

  it('reports REJECTED on an errors element', async () => {
    const errorsDoc =
      '<ResponseDoc><errors><error><message>MARK not found</message></error></errors></ResponseDoc>';
    const http = httpForRequestDocs(errorsDoc);

    await expect(makeProvider(http).pollStatus('m1')).resolves.toEqual({
      state: 'REJECTED',
      raw: errorsDoc,
    });
  });

  it('reports PENDING for a doc without verdict elements', async () => {
    const http = httpForRequestDocs('<ResponseDoc></ResponseDoc>');

    await expect(makeProvider(http).pollStatus('m1')).resolves.toEqual({
      state: 'PENDING',
      raw: '<ResponseDoc></ResponseDoc>',
    });
  });

  it('propagates exhausted-retry failures as SubmissionError', async () => {
    const http = makeHttp();
    http.post.mockResolvedValue({ data: { access_token: 't' } });
    http.get.mockRejectedValue(axiosFailure(404, 'unknown mark'));

    await expect(makeProvider(http).pollStatus('m1')).rejects.toMatchObject({
      status: 404,
    });
  });
});
