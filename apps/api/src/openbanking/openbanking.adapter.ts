import { createHash } from 'node:crypto';

import { GoCardlessAdapter } from './openbanking.gocardless';

/** Minimal projection of a stored `BankConnection` that adapters need. */
export interface BankConnectionRef {
  id: string;
  buildingId: string;
  institutionName: string;
  iban: string;
  mode: string;
}

/** One raw credit/debit line pulled from a bank feed. */
export interface RawTx {
  /** Provider-stable identifier; re-syncs dedupe on it. */
  externalId: string;
  bookedAt: Date;
  amountCents: number;
  remittanceInfo?: string;
}

export interface BankFeedAdapter {
  listTransactions(
    conn: BankConnectionRef,
    /** Inclusive `YYYY-MM-DD`. */
    fromDate: string,
    /** Inclusive `YYYY-MM-DD`. */
    toDate: string,
  ): Promise<RawTx[]>;
}

export const BANK_FEED_ADAPTER = Symbol('BANK_FEED_ADAPTER');

const DAY_MS = 86_400_000;
/** Safety cap so an unbounded range cannot explode into thousands of rows. */
const MAX_SYNC_DAYS = 92;
const NOON_MS = 12 * 3_600_000;

/** Deterministic PRNG (mulberry32); same seed ⇒ same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(...parts: string[]): number {
  const hex = createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 8);
  return parseInt(hex, 16);
}

function externalIdOf(iban: string, dayIso: string, index: number): string {
  const digest = createHash('sha1')
    .update(`${iban}|${dayIso}|${index}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `OFF-${digest}`;
}

const UNIT_LABELS = ['Α1', 'Α2', 'Β1', 'Β2', 'Γ1', 'Δ1'];
const DEBIT_PURPOSES = [
  'ΔΕΗ ΚΟΙΝΟΧΡΗΣΤΑ',
  'ΕΥΔΑΠ',
  'ΣΥΝΤΗΡΗΣΗ ΑΝΕΛΚΥΣΤΗΡΑ',
  'ΚΑΘΑΡΙΟΤΗΤΑ',
];

/**
 * Offline mode: deterministic synthetic feed seeded by connection IBAN + day.
 * Re-syncs of overlapping windows regenerate identical externalIds, so the
 * service-side dedupe keeps stored rows stable.
 */
export class OfflineBankFeedAdapter implements BankFeedAdapter {
  async listTransactions(
    conn: BankConnectionRef,
    fromDate: string,
    toDate: string,
  ): Promise<RawTx[]> {
    const startMs = Math.max(
      Date.parse(`${fromDate}T00:00:00Z`),
      Date.parse(`${toDate}T00:00:00Z`) - (MAX_SYNC_DAYS - 1) * DAY_MS,
    );
    const endMs = Date.parse(`${toDate}T00:00:00Z`);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
      return [];
    }

    const txs: RawTx[] = [];
    for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
      const dayIso = new Date(ms + NOON_MS).toISOString().slice(0, 10);
      txs.push(...this.dayTransactions(conn.iban, dayIso));
    }
    return txs;
  }

  /** Pure per-day generator; stable for a given iban + day pair. */
  private dayTransactions(iban: string, dayIso: string): RawTx[] {
    const roll = mulberry32(seedOf(iban, dayIso))();
    const count = roll < 0.35 ? 0 : roll < 0.78 ? 1 : 2;
    const txs: RawTx[] = [];
    for (let i = 0; i < count; i += 1) {
      const rng = mulberry32(seedOf(iban, dayIso, String(i)));
      const isDebit = rng() < 0.18;
      // Condo-fee-sized amounts: €25.00–€180.00.
      const amountCents = 2_500 + Math.floor(rng() * 15_501);
      txs.push({
        externalId: externalIdOf(iban, dayIso, i),
        bookedAt: new Date(Date.parse(`${dayIso}T12:00:00Z`)),
        amountCents: isDebit ? -amountCents : amountCents,
        remittanceInfo: isDebit
          ? DEBIT_PURPOSES[Math.floor(rng() * DEBIT_PURPOSES.length)]
          : `ΣΥΝΔΡΟΜΗ ${UNIT_LABELS[Math.floor(rng() * UNIT_LABELS.length)]}`,
      });
    }
    return txs;
  }
}

/** Picks the feed mode from `OPENBANKING_MODE`
 * (`gocardless` | default `offline`). */
export function resolveOpenBankingMode(
  mode?: string,
): 'offline' | 'gocardless' {
  const resolved = (
    mode ??
    process.env.OPENBANKING_MODE ??
    'offline'
  ).toLowerCase();
  return resolved === 'gocardless' ? 'gocardless' : 'offline';
}

export function createBankFeedAdapter(mode?: string): BankFeedAdapter {
  return resolveOpenBankingMode(mode) === 'gocardless'
    ? new GoCardlessAdapter()
    : new OfflineBankFeedAdapter();
}
