import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { I18nService } from './i18n.service';

/** Build a fresh I18nService after resetting the injection environment. */
async function makeService(): Promise<I18nService> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  }).compileComponents();
  return TestBed.inject(I18nService);
}

describe('I18nService', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to English when nothing is stored', async () => {
    const service = await makeService();
    expect(service.currentLocale()).toBe('en');
  });

  it('returns the raw key when no dictionaries resolve', async () => {
    const service = await makeService();
    // Seeding via translate() returns the key until dicts load or on load error.
    expect(service.translate('greet')).toBe('greet');
  });

  it('translates from the active dictionary after it loads', async () => {
    const service = await makeService();
    const httpMock = TestBed.inject(HttpTestingController);

    // Default locale is en → both the active dict and the baseline hit en.json.
    httpMock.match('i18n/en.json').forEach((req) => req.flush({ greet: 'Hello' }));
    await service;
    expect(service.translate('greet')).toBe('Hello');
    expect(service.translate('missing')).toBe('missing');
  });

  it('falls back to the English baseline for keys missing in the active locale', async () => {
    localStorage.setItem('locale', 'ja');
    const service = await makeService();
    const httpMock = TestBed.inject(HttpTestingController);

    // ja active dict omitted the key; en baseline provides it.
    httpMock.match('i18n/ja.json').forEach((req) => req.flush({ other: '別' }));
    httpMock.match('i18n/en.json').forEach((req) => req.flush({ greet: 'Hello' }));
    await service;

    expect(service.translate('greet')).toBe('Hello');
    expect(service.translate('other')).toBe('別');
  });

  it('prefers the active dictionary over the English baseline', async () => {
    localStorage.setItem('locale', 'ja');
    const service = await makeService();
    const httpMock = TestBed.inject(HttpTestingController);

    httpMock.match('i18n/ja.json').forEach((req) => req.flush({ greet: 'こんにちは' }));
    httpMock.match('i18n/en.json').forEach((req) => req.flush({ greet: 'Hello' }));
    await service;

    expect(service.translate('greet')).toBe('こんにちは');
  });

  it('loads and applies a newly selected locale, persisting it', async () => {
    const service = await makeService();
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.match('i18n/en.json').forEach((req) => req.flush({ greet: 'Hello' }));
    await service;

    service.setLocale('zh');
    // setLocale kicks off a new load for the target dict.
    httpMock.match('i18n/zh.json').forEach((req) => req.flush({ greet: '你好' }));
    await service;

    expect(service.currentLocale()).toBe('zh');
    expect(localStorage.getItem('locale')).toBe('zh');
    expect(service.translate('greet')).toBe('你好');
  });

  it('ignores unsupported locales', async () => {
    const service = await makeService();
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.match('i18n/en.json').forEach((req) => req.flush({}));
    await service;
    httpMock.verify();

    service.setLocale('fr');
    expect(service.currentLocale()).toBe('en');
  });

  it('clears the dictionary when a locale file fails to load', async () => {
    const service = await makeService();
    const httpMock = TestBed.inject(HttpTestingController);
    httpMock.match('i18n/en.json').forEach((req) => req.flush({ greet: 'Hello' }));
    await service;

    service.setLocale('ja');
    httpMock.match('i18n/ja.json').forEach((req) =>
      req.flush('boom', { status: 500, statusText: 'Internal Server Error' }),
    );
    await service;
    httpMock.verify();

    // Active dict cleared; baseline still resolves via en (loaded earlier).
    expect(service.translate('greet')).toBe('Hello');
  });
});