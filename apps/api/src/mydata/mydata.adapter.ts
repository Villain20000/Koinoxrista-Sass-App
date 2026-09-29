import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';

import { LiveAadeMyDataProvider } from './mydata.live';

/** Payload submitted to the provider for one paid invoice. */
export interface MyDataSubmitInput {
  invoiceId: string;
  series: string;
  seqNo: number;
  paymentMethodCode: string;
  netAmountCents: number;
  vatAmountCents: number;
  /** Issue date as YYYY-MM-DD; live submissions require it (AADE XSD). */
  issueDate?: string;
  /** AADE document-type code (2.1 = service invoice); defaults to 2.1. */
  invoiceType?: string;
  /** Income classification, e.g. category1_1 / E3_561_001. */
  classificationCategory?: string;
  classificationType?: string;
}

export interface MyDataSubmitResult {
  mark: string;
  raw: string;
}

export type MyDataInvoiceState = 'ACCEPTED' | 'REJECTED' | 'PENDING';

export interface MyDataPollResult {
  state: MyDataInvoiceState;
  raw: string;
}

export interface MyDataProvider {
  submit(invoice: MyDataSubmitInput): Promise<MyDataSubmitResult>;
  /** Present only on providers backed by a queryable AADE endpoint (live). */
  pollStatus?(mark: string): Promise<MyDataPollResult>;
}

export const MYDATA_PROVIDER = Symbol('MYDATA_PROVIDER');

/** Offline mode: deterministic synthetic MARK, no network calls. */
export class OfflineMyDataProvider implements MyDataProvider {
  async submit(invoice: MyDataSubmitInput): Promise<MyDataSubmitResult> {
    const digest = createHash('sha1')
      .update(invoice.invoiceId)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();
    return {
      mark: `4000${digest}`,
      raw: JSON.stringify(invoice),
    };
  }
}

/** Picks the provider from `MYDATA_MODE` (`live` | default `offline`). */
export function createMyDataProvider(
  mode?: string,
  http?: AxiosInstance,
): MyDataProvider {
  const resolved = (mode ?? process.env.MYDATA_MODE ?? 'offline').toLowerCase();
  return resolved === 'live'
    ? new LiveAadeMyDataProvider(http ? { http } : undefined)
    : new OfflineMyDataProvider();
}
