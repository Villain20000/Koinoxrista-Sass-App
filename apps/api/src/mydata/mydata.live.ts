import axios, { AxiosInstance, AxiosResponse } from 'axios';

import type {
  MyDataPollResult,
  MyDataProvider,
  MyDataSubmitInput,
  MyDataSubmitResult,
} from './mydata.adapter';

/** Staging endpoint per AADE docs; prod swaps in via MYDATA_BASE_URL. */
export const DEFAULT_MYDATA_BASE_URL = 'https://mydatapi.aade.gr/staging';

const TOKEN_PATH = '/oauth/token';
const SEND_INVOICE_PATH = '/SendInvoiceDocs';
const REQUEST_DOCS_PATH = '/RequestDocs';
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_TTL_SECONDS = 3600;

export interface RetryOptions {
  retries?: number;
  baseMs?: number;
}

export class SubmissionError extends Error {
  readonly status?: number;
  readonly detail?: string;
  readonly permanent: boolean;

  constructor(
    message: string,
    options: { status?: number; detail?: string; permanent?: boolean } = {},
  ) {
    super(options.detail ? `${message}: ${options.detail}` : message);
    this.name = 'SubmissionError';
    this.status = options.status;
    this.detail = options.detail;
    this.permanent =
      options.permanent ??
      (options.status !== undefined &&
        options.status >= 400 &&
        options.status < 500 &&
        options.status !== 429);
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Jittered exponential backoff (0.5x–1.5x of base * 2^attempt). */
function backoffDelay(attempt: number, baseMs: number): number {
  return Math.round(baseMs * 2 ** attempt * (0.5 + Math.random()));
}

/** Retries transient failures; gives up immediately on permanent ones. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { retries = 3, baseMs = 200 }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw lastError;
      }
      if (error instanceof SubmissionError && error.permanent) {
        throw error;
      }
      await sleep(backoffDelay(attempt, baseMs));
    }
  }
}

export interface LiveMyDataConfig {
  baseUrl?: string;
  userId?: string;
  clientSecret?: string;
  subscriptionKey?: string;
  http?: AxiosInstance;
  retry?: RetryOptions;
}

function toSubmissionError(error: unknown, message: string): SubmissionError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    return new SubmissionError(message, {
      status: error.response?.status,
      detail:
        typeof data === 'string' && data.length > 0 ? data : error.message,
    });
  }
  if (error instanceof SubmissionError) {
    return error;
  }
  return new SubmissionError(message, {
    detail: error instanceof Error ? error.message : String(error),
  });
}

function tagValue(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
}

function escapeXml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const euros = (cents: number): string => (cents / 100).toFixed(2);

/** AADE VAT-category codes keyed by the effective percentage rate. */
const VAT_CATEGORY_BY_RATE: Record<number, string> = {
  24: '1',
  13: '2',
  6: '3',
  17: '4',
  9: '5',
  4: '6',
  0: '7',
};

function vatCategory(netCents: number, vatCents: number): string {
  const rate =
    netCents > 0 ? Math.round((vatCents / netCents) * 100) : 0;
  return VAT_CATEGORY_BY_RATE[rate] ?? '1';
}

const DEFAULT_INVOICE_TYPE = '2.1'; // service provision invoice
const DEFAULT_CLASSIFICATION_CATEGORY = 'category1_1';
const DEFAULT_CLASSIFICATION_TYPE = 'E3_561_001';
const CURRENCY = 'EUR';

function incomeClassification(
  category: string,
  type: string,
  amountCents: number,
): string {
  return [
    '<incomeClassification>',
    `<classificationType>${escapeXml(type)}</classificationType>`,
    `<classificationCategory>${escapeXml(category)}</classificationCategory>`,
    `<amount>${euros(amountCents)}</amount>`,
    '</incomeClassification>',
  ].join('');
}

/**
 * XSD-compliant InvoicesDoc (v1.0.x) sent as the URL-encoded `invoice`
 * form field: issue metadata, payment method, line details with income
 * classification, and an invoiceSummary with document totals.
 */
function invoicePayload(invoice: MyDataSubmitInput): string {
  const grossCents = invoice.netAmountCents + invoice.vatAmountCents;
  const issueDate = invoice.issueDate ?? new Date().toISOString().slice(0, 10);
  const classification = incomeClassification(
    invoice.classificationCategory ?? DEFAULT_CLASSIFICATION_CATEGORY,
    invoice.classificationType ?? DEFAULT_CLASSIFICATION_TYPE,
    invoice.netAmountCents,
  );
  return [
    '<InvoicesDoc version="1.0.8"><invoice>',
    `<series>${escapeXml(invoice.series)}</series>`,
    `<aa>${invoice.seqNo}</aa>`,
    `<issueDate>${escapeXml(issueDate)}</issueDate>`,
    `<invoiceType>${escapeXml(invoice.invoiceType ?? DEFAULT_INVOICE_TYPE)}</invoiceType>`,
    `<currency>${CURRENCY}</currency>`,
    '<paymentMethods><paymentMethod>',
    `<type>${escapeXml(invoice.paymentMethodCode)}</type>`,
    `<amount>${euros(grossCents)}</amount>`,
    '</paymentMethod></paymentMethods>',
    '<invoiceDetails>',
    '<lineNumber>1</lineNumber>',
    `<netValue>${euros(invoice.netAmountCents)}</netValue>`,
    `<vatCategory>${vatCategory(invoice.netAmountCents, invoice.vatAmountCents)}</vatCategory>`,
    `<vatAmount>${euros(invoice.vatAmountCents)}</vatAmount>`,
    classification,
    '</invoiceDetails>',
    '<invoiceSummary>',
    `<documentTotalNetValue>${euros(invoice.netAmountCents)}</documentTotalNetValue>`,
    `<documentTotalVatAmount>${euros(invoice.vatAmountCents)}</documentTotalVatAmount>`,
    `<totalGrossValue>${euros(grossCents)}</totalGrossValue>`,
    classification,
    '</invoiceSummary>',
    '</invoice></InvoicesDoc>',
  ].join('');
}

/**
 * Live ΑΑΔΕ myDATA REST client. Auth: client_credentials OAuth token cached
 * until 60s before expiry. Submissions poll for reconciliation via RequestDocs.
 */
export class LiveAadeMyDataProvider implements MyDataProvider {
  private readonly http: AxiosInstance;
  private readonly retryOptions: RetryOptions;
  private readonly userId: string;
  private readonly clientSecret: string;
  private readonly subscriptionKey: string;
  private token?: { value: string; expiresAtMs: number };

  constructor(config: LiveMyDataConfig = {}) {
    this.userId = config.userId ?? process.env.MYDATA_USER_ID ?? '';
    this.subscriptionKey =
      config.subscriptionKey ?? process.env.MYDATA_SUBSCRIPTION_KEY ?? '';
    if (!this.userId || !this.subscriptionKey) {
      throw new Error(
        'MYDATA_MODE=live requires MYDATA_USER_ID and MYDATA_SUBSCRIPTION_KEY',
      );
    }
    this.clientSecret =
      config.clientSecret ?? process.env.MYDATA_CLIENT_SECRET ?? '';
    this.retryOptions = config.retry ?? {};
    this.http =
      config.http ??
      axios.create({
        baseURL:
          config.baseUrl ??
          process.env.MYDATA_BASE_URL ??
          DEFAULT_MYDATA_BASE_URL,
      });
  }

  async submit(invoice: MyDataSubmitInput): Promise<MyDataSubmitResult> {
    return retryWithBackoff(() => this.submitOnce(invoice), this.retryOptions);
  }

  async pollStatus(mark: string): Promise<MyDataPollResult> {
    return retryWithBackoff(() => this.requestDocs(mark), this.retryOptions);
  }

  private async submitOnce(
    invoice: MyDataSubmitInput,
  ): Promise<MyDataSubmitResult> {
    const token = await this.accessToken();
    let response: AxiosResponse<unknown>;
    try {
      response = await this.http.post<unknown>(
        SEND_INVOICE_PATH,
        `invoice=${encodeURIComponent(invoicePayload(invoice))}`,
        {
          headers: this.resourceHeaders(token),
          transformResponse: [(data: unknown) => data],
        },
      );
    } catch (error) {
      throw toSubmissionError(error, 'myDATA invoice submission failed');
    }
    const raw = this.responseText(response.data);
    const uid = tagValue(raw, 'uid');
    if (!uid) {
      throw new SubmissionError('myDATA response is missing a uid', {
        detail: raw,
        permanent: true,
      });
    }
    return { mark: uid, raw };
  }

  private async requestDocs(mark: string): Promise<MyDataPollResult> {
    const token = await this.accessToken();
    let response: AxiosResponse<unknown>;
    try {
      response = await this.http.get<unknown>(REQUEST_DOCS_PATH, {
        params: { mark },
        headers: this.resourceHeaders(token),
        transformResponse: [(data: unknown) => data],
      });
    } catch (error) {
      throw toSubmissionError(error, 'myDATA document lookup failed');
    }
    const raw = this.responseText(response.data);
    const errors = tagValue(raw, 'errors')?.trim();
    if (errors) {
      return { state: 'REJECTED', raw };
    }
    const accepted =
      Boolean(tagValue(raw, 'uid')) &&
      Boolean(tagValue(raw, 'authenticationCode'));
    return { state: accepted ? 'ACCEPTED' : 'PENDING', raw };
  }

  private async accessToken(): Promise<string> {
    if (
      this.token &&
      this.token.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > Date.now()
    ) {
      return this.token.value;
    }
    let response: AxiosResponse<{
      access_token?: string;
      expires_in?: number;
    }>;
    try {
      response = await this.http.post(
        TOKEN_PATH,
        'grant_type=client_credentials',
        {
          auth: { username: this.userId, password: this.clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
    } catch (error) {
      throw toSubmissionError(error, 'myDATA OAuth token request failed');
    }
    const value = response.data?.access_token;
    if (!value) {
      throw new SubmissionError('myDATA OAuth response has no access_token', {
        detail: JSON.stringify(response.data),
        permanent: true,
      });
    }
    const ttlSeconds = Number(
      response.data?.expires_in ?? DEFAULT_TOKEN_TTL_SECONDS,
    );
    this.token = {
      value,
      expiresAtMs: Date.now() + ttlSeconds * 1000,
    };
    return value;
  }

  private resourceHeaders(token: string): Record<string, string> {
    return {
      'aade-user-id': this.userId,
      'ocp-apim-subscription-key': this.subscriptionKey,
      Authorization: `Bearer ${token}`,
    };
  }

  private responseText(data: unknown): string {
    if (typeof data === 'string') {
      return data;
    }
    return JSON.stringify(data ?? '');
  }
}
