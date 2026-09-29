import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export const SUPPORTED_LANGUAGES = ['el', 'en', 'zh', 'pt', 'ja', 'es'] as const;
export type AppLocale = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';

export const LOCALE_TO_INTL: Record<AppLocale, string> = {
  el: 'el-GR',
  en: 'en-US',
  zh: 'zh-CN',
  pt: 'pt-BR',
  ja: 'ja-JP',
  es: 'es-ES',
};

export type TranslationDict = Record<string, string>;

const EMPTY_DICT: TranslationDict = {};

/**
 * Lightweight, signals-driven internationalization for the standalone,
 * zoneless Angular app. Loads JSON dictionaries from `public/i18n/`.
 *
 * The active locale's dictionary is the source of truth; keys it does not
 * contain fall back to the English baseline (then to the raw key). This lets
 * partial translations degrade gracefully instead of showing raw keys.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly http = inject(HttpClient);

  private readonly locale = signal<AppLocale>(this.resolveInitialLocale());
  private readonly dict = signal<TranslationDict>(EMPTY_DICT);
  private readonly enDict = signal<TranslationDict>(EMPTY_DICT);

  /** The active locale (read-only signal). */
  readonly currentLocale = this.locale.asReadonly();

  constructor() {
    // Load the active locale dict plus the English baseline for fallback.
    void this.loadDict(this.locale());
    void this.loadEnDict();
  }

  /** Translate a key using the active dictionary (falling back to English). */
  translate(key: string): string {
    const value = this.dict()[key];
    if (value !== undefined) return value;
    const en = this.enDict()[key];
    return en ?? key;
  }

  /** Reactive translate helper for bindings: re-evaluates on locale change. */
  t = (key: string): string => this.translate(key);

  /** Set the active locale and persist it. */
  setLocale(locale: string): void {
    if (!SUPPORTED_LANGUAGES.includes(locale as AppLocale)) {
      return;
    }
    const next = locale as AppLocale;
    this.locale.set(next);
    try {
      localStorage.setItem('locale', next);
    } catch {
      // localStorage may be unavailable (SSR/privacy mode); ignore.
    }
    void this.loadDict(next);
  }

  private async loadDict(locale: AppLocale): Promise<void> {
    try {
      const data = await this.http
        .get<TranslationDict>(`i18n/${locale}.json`)
        .toPromise();
      this.dict.set(data ?? EMPTY_DICT);
    } catch {
      this.dict.set(EMPTY_DICT);
    }
  }

  private async loadEnDict(): Promise<void> {
    try {
      const data = await this.http
        .get<TranslationDict>('i18n/en.json')
        .toPromise();
      this.enDict.set(data ?? EMPTY_DICT);
    } catch {
      this.enDict.set(EMPTY_DICT);
    }
  }

  private resolveInitialLocale(): AppLocale {
    try {
      const saved = localStorage.getItem('locale');
      if (saved && SUPPORTED_LANGUAGES.includes(saved as AppLocale)) {
        return saved as AppLocale;
      }
    } catch {
      // localStorage unavailable; fall through to default.
    }
    return DEFAULT_LOCALE;
  }
}