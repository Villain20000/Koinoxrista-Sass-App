import { Pipe, PipeTransform, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { I18nService, LOCALE_TO_INTL } from '../core/i18n.service';
import { formatMoney } from './format';

/**
 * Currency-aware money pipe — resolves building currency from AuthService
 * and locale from I18nService, then delegates to `formatMoney` (Intl).
 *
 * Usage: {{ cents | money }}  or  {{ cents | money:'USD':'en-US' }}
 * When no args are given, uses the active building's currency (EUR fallback)
 * and the active UI locale (mapped to Intl locale).
 */
@Pipe({
  name: 'money',
  standalone: true,
  pure: false,
})
export class MoneyPipe implements PipeTransform {
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);

  transform(
    cents: number | null | undefined,
    currencyOverride?: string,
    localeOverride?: string,
  ): string {
    if (cents == null || !Number.isFinite(cents)) return '—';
    const currency =
      currencyOverride ?? this.auth.currentUser()?.currency ?? 'EUR';
    const locale =
      localeOverride ??
      LOCALE_TO_INTL[this.i18n.currentLocale()] ??
      'el-GR';
    return formatMoney(cents, { currency, locale });
  }
}
