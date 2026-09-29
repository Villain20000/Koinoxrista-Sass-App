import {
  DEFAULT_CURRENCY,
  DEFAULT_MARKET,
  MARKET_REGISTRY,
  marketCurrency,
  resolveMarket,
} from './market';
import {
  ANNUAL_DISCOUNT_BPS,
  periodTotalCentsForCurrency,
  tierPriceCentsForCurrency,
} from './subscriptions';

describe('market registry', () => {
  it('defaults to Greece (GR/EUR/viva) when unset or unknown', () => {
    expect(DEFAULT_MARKET).toBe('GR');
    expect(DEFAULT_CURRENCY).toBe('EUR');

    const gr = resolveMarket(undefined);
    expect(gr.market).toBe('GR');
    expect(gr.currency).toBe('EUR');
    expect(gr.pspProvider).toBe('viva');
    expect(gr.locale).toBe('el-GR');

    const unknown = resolveMarket('ATLANTIS');
    expect(unknown.currency).toBe('EUR');
    expect(marketCurrency(null)).toBe('EUR');
  });

  it('covers the targeted international markets', () => {
    const expectations: Record<string, { currency: string; psp: string }> = {
      US: { currency: 'USD', psp: 'stripe' },
      CA: { currency: 'CAD', psp: 'stripe' },
      MX: { currency: 'MXN', psp: 'mercadopago' },
      BR: { currency: 'BRL', psp: 'mercadopago' },
      AR: { currency: 'ARS', psp: 'mercadopago' },
      CL: { currency: 'CLP', psp: 'mercadopago' },
      CO: { currency: 'COP', psp: 'mercadopago' },
      PE: { currency: 'PEN', psp: 'mercadopago' },
      EU: { currency: 'EUR', psp: 'stripe' },
    };
    for (const [code, { currency, psp }] of Object.entries(expectations)) {
      const profile = resolveMarket(code);
      expect(profile.market).toBe(code);
      expect(profile.currency).toBe(currency);
      expect(profile.pspProvider).toBe(psp);
    }
  });

  it('exposes every market code in the registry', () => {
    for (const code of Object.keys(MARKET_REGISTRY)) {
      expect(resolveMarket(code).market).toBe(code);
    }
  });
});

describe('currency-aware pricing (P0-1)', () => {
  it('returns the EUR price for unknown currencies (safe default)', () => {
    expect(tierPriceCentsForCurrency('BASIC', 'XYZ')).toBe(150);
  });

  it('scales the EUR tier price by the currency bucket', () => {
    // USD bucket is 100% of EUR; MXN is 1800 bps → ×1.8.
    expect(tierPriceCentsForCurrency('PREMIUM', 'USD')).toBe(300);
    expect(tierPriceCentsForCurrency('BASIC', 'MXN')).toBe(270); // 150 × 1.8
  });

  it('computes period totals with the currency rate and annual discount', () => {
    const monthly = periodTotalCentsForCurrency('BASIC', 'MONTHLY', 10, 'USD');
    expect(monthly).toBe(150 * 10);

    const annual = periodTotalCentsForCurrency('BASIC', 'ANNUAL', 10, 'USD');
    const expected = Math.round((150 * 10 * 12 * (10000 - ANNUAL_DISCOUNT_BPS)) / 10000);
    expect(annual).toBe(expected);
  });
});