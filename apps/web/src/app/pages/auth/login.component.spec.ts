import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { LoginPage } from './login.component';

const EN_DICT: Record<string, string> = {
  'login.title': 'Sign in',
  'login.invalidEmail': 'Enter a valid email.',
};

/** Flush the I18nService dictionary loads (en locale + baseline are both en). */
function flushI18n(httpMock: HttpTestingController): void {
  httpMock
    .match('i18n/en.json')
    .forEach((req) => req.flush(EN_DICT));
}

function setInput(compiled: HTMLElement, id: string, value: string): void {
  const input = compiled.querySelector(`#${id}`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('LoginPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
  });

  it('renders the login title', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    flushI18n(httpMock);
    await fixture.whenStable();
    await Promise.resolve();
    fixture.componentRef.changeDetectorRef.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Sign in');
  });

  it('shows validation errors after submitting an empty form', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    flushI18n(httpMock);
    const compiled = fixture.nativeElement as HTMLElement;
    (compiled.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(compiled.textContent).toContain('Enter a valid email.');
  });

  it('shows the demo hint box', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    flushI18n(httpMock);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('admin@demo.gr');
  });

  it('posts credentials to /api/auth/login on submit', async () => {
    const httpMock = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    flushI18n(httpMock);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    setInput(compiled, 'email', 'admin@demo.gr');
    setInput(compiled, 'password', 'Admin1234!');
    (compiled.querySelector('button[type="submit"]') as HTMLButtonElement).click();

    const loginReq = httpMock.expectOne('/api/auth/login');
    expect(loginReq.request.method).toBe('POST');
    expect(loginReq.request.body).toEqual({
      email: 'admin@demo.gr',
      password: 'Admin1234!',
    });
    loginReq.flush({ accessToken: 'token-1' });
    httpMock
      .expectOne('/api/auth/me')
      .flush({ id: 'u1', email: 'admin@demo.gr', role: 'ADMIN', buildingId: 'b1' });

    expect(auth.currentUser()?.role).toBe('ADMIN');
    httpMock.verify();
  });
});