/**
 * Live PSD2 feed client (GoCardless Bank Account Data — former Nordigen).
 * Skeleton behind `OPENBANKING_MODE=gocardless`: fails fast at construction
 * unless the secret id/key env flags are configured.
 */

import type { BankConnectionRef, BankFeedAdapter, RawTx } from './openbanking.adapter';

/** Staging endpoint per GoCardless Bank Account Data docs. */
export const DEFAULT_GOCARDLESS_BASE_URL = 'https://bankaccountdata.gocardless.com';

const TRANSACTIONS_PATH = '/api/v2/transactions/';

/** Thrown when OPENBANKING_MODE=gocardless but credentials are missing. */
export class NotConfiguredError extends Error {
  constructor() {
    super(
      'OPENBANKING_MODE=gocardless requires GC_SECRET_ID and GC_SECRET_KEY',
    );
    this.name = 'NotConfiguredError';
  }
}

/** Thrown when the upstream feed responds with a non-2xx status. */
export class FeedFetchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FeedFetchError';
    this.status = status;
  }
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface GoCardlessConfig {
  baseUrl?: string;
  secretId?: string;
  secretKey?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: FetchFn;
}

interface GoCardlessBookedTx {
  transactionId?: string;
  entryReference?: string;
  bookingDate?: string;
  transactionAmount?: { amount?: string };
  remittanceInformationUnstructured?: string;
}

function toRawTx(booked: GoCardlessBookedTx): RawTx | null {
  const externalId = booked.transactionId ?? booked.entryReference;
  const amountStr = booked.transactionAmount?.amount;
  if (!externalId || !booked.bookingDate || !amountStr) return null;
  const amountCents = Math.round(Number.parseFloat(amountStr) * 100);
  if (!Number.isFinite(amountCents)) return null;
  return {
    externalId,
    bookedAt: new Date(Date.parse(`${booked.bookingDate}T12:00:00Z`)),
    amountCents,
    ...(booked.remittanceInformationUnstructured
      ? { remittanceInfo: booked.remittanceInformationUnstructured }
      : {}),
  };
}

export class GoCardlessAdapter implements BankFeedAdapter {
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchFn;

  constructor(config: GoCardlessConfig = {}) {
    this.secretId = config.secretId ?? process.env.GC_SECRET_ID ?? '';
    this.secretKey = config.secretKey ?? process.env.GC_SECRET_KEY ?? '';
    if (!this.secretId || !this.secretKey) {
      throw new NotConfiguredError();
    }
    this.baseUrl = (
      config.baseUrl ??
      process.env.GC_BASE_URL ??
      DEFAULT_GOCARDLESS_BASE_URL
    ).replace(/\/+$/, '');
    this.fetchFn = config.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async listTransactions(
    conn: BankConnectionRef,
    fromDate: string,
    toDate: string,
  ): Promise<RawTx[]> {
    const url = new URL(TRANSACTIONS_PATH, this.baseUrl);
    url.searchParams.set('iban', conn.iban);
    url.searchParams.set('created_after', fromDate);
    url.searchParams.set('created_before', toDate);

    let response: Response;
    try {
      response = await this.fetchFn(url.toString(), {
        headers: {
          'Secret-Id': this.secretId,
          'Secret-Key': this.secretKey,
          Accept: 'application/json',
        },
      });
    } catch (error) {
      throw new FeedFetchError(
        `GoCardless feed request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        0,
      );
    }
    if (!response.ok) {
      throw new FeedFetchError(
        `GoCardless feed request failed (${response.status})`,
        response.status,
      );
    }
    const payload = (await response.json()) as {
      transactions?: { booked?: GoCardlessBookedTx[] };
    };
    return (payload.transactions?.booked ?? []).flatMap((booked) => {
      const tx = toRawTx(booked);
      return tx ? [tx] : [];
    });
  }
}
