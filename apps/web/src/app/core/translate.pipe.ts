import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';

/**
 * Reactive translate pipe: `{{ 'nav.feed' | translate }}`.
 * The transform reads the I18nService signals, so zoneless change
 * detection re-evaluates it whenever the locale or dictionaries change.
 */
@Pipe({
  name: 'translate',
  standalone: true,
  pure: false,
})
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string | null | undefined): string {
    return key ? this.i18n.translate(key) : '';
  }
}