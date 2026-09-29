import { describe, expect, it } from 'vitest';

import { formatEuros, formatMoney } from './format';

describe('formatMoney (P0-1 currency-aware formatting)', () => {
  it('formats EUR with el-GR separators by default', () => {
    // Intl currency style separates amount and symbol with a non-breaking space.
    expect(formatMoney(12_345)).toBe('123,45\u00a0€');
    expect(formatMoney(5)).toBe('0,05\u00a0€');
  });

  it('formats a given currency + locale pair via Intl', () => {
    expect(formatMoney(12_345, { currency: 'USD', locale: 'en-US' })).toBe(
      '$123.45',
    );
    expect(formatMoney(12_345, { currency: 'BRL', locale: 'pt-BR' })).toBe(
      'R$ 123,45',
    );
  });

  it('falls back to the Greek-euro renderer for unknown locales/currencies', () => {
    expect(formatMoney(12_345, { currency: 'NOPE', locale: 'xx-XX' })).toBe(
      '123,45 €',
    );
  });
});

describe('formatEuros (legacy Greek rendering kept byte-identical)', () => {
  it('matches the pre-internationalization output exactly', () => {
    expect(formatEuros(0)).toBe('0,00 €');
    expect(formatEuros(5)).toBe('0,05 €');
    expect(formatEuros(12_345)).toBe('123,45 €');
    expect(formatEuros(1_234_567)).toBe('12.345,67 €');
    expect(formatEuros(-950)).toBe('-9,50 €');
  });
});