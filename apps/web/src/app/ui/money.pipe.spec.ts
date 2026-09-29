import { describe, expect, it, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MoneyPipe } from './money.pipe';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';

describe('MoneyPipe (P0-1 currency-aware)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function setup(opts: { currency?: string; locale?: string } = {}) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), MoneyPipe, AuthService, I18nService],
    }).compileComponents();

    const auth = TestBed.inject(AuthService);
    const i18n = TestBed.inject(I18nService);
    const pipe = TestBed.inject(MoneyPipe);

    if (opts.currency) {
      auth.currentUser.set({
        id: 'u1',
        email: 'a@b.gr',
        role: 'ADMIN' as const,
        buildingId: 'b1',
        currency: opts.currency,
      });
    }
    if (opts.locale) {
      i18n.setLocale(opts.locale);
      // flush dict loads
      const httpMock = TestBed.inject(
        (await import('@angular/common/http/testing')).HttpTestingController,
      );
      httpMock.match(() => true).forEach((req) => req.flush({}));
    }
    return { pipe, auth, i18n };
  }

  it('formats with building currency + active locale by default', async () => {
    const { pipe } = await setup({ currency: 'USD', locale: 'en' });
    // en -> en-US via LOCALE_TO_INTL
    expect(pipe.transform(12345)).toBe('$123.45');
  });

  it('falls back to EUR/el-GR when no building currency and locale is el', async () => {
    const { pipe } = await setup({ locale: 'el' });
    expect(pipe.transform(12345)).toBe('123,45\u00a0€');
  });

  it('respects explicit overrides', async () => {
    const { pipe } = await setup({ currency: 'EUR', locale: 'el' });
    expect(pipe.transform(12345, 'BRL', 'pt-BR')).toBe('R$\u00a0123,45');
  });

  it('returns em dash for null/NaN', async () => {
    const { pipe } = await setup();
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(NaN)).toBe('—');
  });

  it('formats es-ES correctly via explicit override', async () => {
    const { pipe } = await setup();
    expect(pipe.transform(12345, 'EUR', 'es-ES')).toContain('123,45');
  });
});
