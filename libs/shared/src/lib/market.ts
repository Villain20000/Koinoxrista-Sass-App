/**
 * Market registry — the configuration that makes PolykatoikiaOS sellable in
 * Greece (default) and abroad. Each market groups the regional currency,
 * default payment provider / rails, default number locale, primary languages,
 * and e-invoice compliance. Building market codes match the Prisma `market`
 * column and are synthetic region codes, not free text.
 */

export type MarketCode =
  | 'GR'
  | 'EU'
  | 'US'
  | 'CA'
  | 'MX'
  | 'BR'
  | 'AR'
  | 'CL'
  | 'CO'
  | 'PE';

/** ISO-4217 currency codes used by the registry. */
export type CurrencyCode =
  | 'EUR' | 'USD' | 'CAD' | 'MXN' | 'BRL'
  | 'ARS' | 'CLP' | 'COP' | 'PEN' | 'GBP'
  | 'PLN' | 'SEK' | 'CZK';

/** Building-level PSP selection. `viva` is the Greek default. */
export type PspProvider = 'viva' | 'stripejp' | 'stripe' | 'mercadopago' | 'gmo';

export interface MarketProfile {
  /** Region code used in the DB (`Building.market`). */
  market: MarketCode;
  /** Default ISO-4217 currency for buildings in this market. */
  currency: CurrencyCode;
  /** Default provider resolved when Building.pspProvider is unset. */
  pspProvider: PspProvider;
  /** BCP47 number/date locale used for default formatting. */
  locale: string;
  /** Primary UI languages offered to users in this market. */
  languages: string[];
  /** E-invoice compliance adapter key. `mydata` only applies to GR. */
  eInvoice: string;
}

/** Canonical list — order matters for dropdowns/docs, not for behavior. */
export const MARKET_CODES: MarketCode[] = [
  'GR', 'EU', 'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE',
];

export const DEFAULT_MARKET: MarketCode = 'GR';
export const DEFAULT_CURRENCY: CurrencyCode = 'EUR';

/**
 * Single source of truth for per-market regional defaults. Greece is the
 * zero-configuration baseline; every other market opts in per building.
 */
export const MARKET_REGISTRY: Record<MarketCode, MarketProfile> = {
  GR: {
    market: 'GR',
    currency: 'EUR',
    pspProvider: 'viva',
    locale: 'el-GR',
    languages: ['el'],
    eInvoice: 'mydata',
  },
  EU: {
    market: 'EU',
    currency: 'EUR',
    pspProvider: 'stripe',
    locale: 'en-GB',
    languages: ['en', 'de', 'fr', 'es', 'it', 'pt'],
    eInvoice: 'vat-memo',
  },
  US: {
    market: 'US',
    currency: 'USD',
    pspProvider: 'stripe',
    locale: 'en-US',
    languages: ['en'],
    eInvoice: 'sales-memo',
  },
  CA: {
    market: 'CA',
    currency: 'CAD',
    pspProvider: 'stripe',
    locale: 'en-CA',
    languages: ['en', 'fr'],
    eInvoice: 'vat-memo',
  },
  MX: {
    market: 'MX',
    currency: 'MXN',
    pspProvider: 'mercadopago',
    locale: 'es-MX',
    languages: ['es'],
    eInvoice: 'cfdi',
  },
  BR: {
    market: 'BR',
    currency: 'BRL',
    pspProvider: 'mercadopago',
    locale: 'pt-BR',
    languages: ['pt'],
    eInvoice: 'nfe',
  },
  AR: {
    market: 'AR',
    currency: 'ARS',
    pspProvider: 'mercadopago',
    locale: 'es-AR',
    languages: ['es'],
    eInvoice: 'vat-memo',
  },
  CL: {
    market: 'CL',
    currency: 'CLP',
    pspProvider: 'mercadopago',
    locale: 'es-CL',
    languages: ['es'],
    eInvoice: 'vyes',
  },
  CO: {
    market: 'CO',
    currency: 'COP',
    pspProvider: 'mercadopago',
    locale: 'es-CO',
    languages: ['es'],
    eInvoice: 'vat-memo',
  },
  PE: {
    market: 'PE',
    currency: 'PEN',
    pspProvider: 'mercadopago',
    locale: 'es-PE',
    languages: ['es'],
    eInvoice: 'vat-memo',
  },
};

/** True when no market profile exists (defensive). */
export function isMarketCode(value: string): value is MarketCode {
  return Object.prototype.hasOwnProperty.call(MARKET_REGISTRY, value);
}

/** Resolve a market to its profile, falling back to Greece for unknown input. */
export function resolveMarket(market: string | null | undefined): MarketProfile {
  if (market && isMarketCode(market)) {
    return MARKET_REGISTRY[market];
  }
  return MARKET_REGISTRY[DEFAULT_MARKET];
}

/** Default currency for a market code (falls back to EUR). */
export function marketCurrency(
  market: string | null | undefined,
): CurrencyCode {
  return resolveMarket(market).currency;
}