import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  catchError,
  map,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import type { MembershipDto, Role } from '@org/shared';
import { environment } from '../../environments/environment';
import { AnalyticsService } from './analytics.service';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  buildingId: string | null;
  /** Present once the API serves the 2FA flag from /auth/me. */
  twoFactorEnabled?: boolean;
  /** Synthetic region code for the active building (defaults to GR). */
  market?: string;
  /** ISO-4217 currency for the active building (defaults to EUR). */
  currency?: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Raw invite token; role/building are derived from it server-side. */
  inviteToken?: string;
  /** Referral code (`BLD-XXXXXX`) captured at /register?ref=… */
  referralCode?: string;
}

/**
 * Result of POST /auth/login (mirrors libs/shared/src/lib/two-factor.ts until
 * the shared barrel export lands): either signed in, or a 2FA challenge.
 */
export type LoginStep =
  | { status: 'signed-in'; user: AuthUser }
  | { status: 'two-factor'; ticket: string };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly analytics = inject(AnalyticsService);
  private token: string | null = null;

  readonly currentUser = signal<AuthUser | null>(null);
  readonly memberships = signal<MembershipDto[]>([]);

  get accessToken(): string | null {
    return this.token;
  }

  get role(): Role | null {
    return this.currentUser()?.role ?? null;
  }

  get isAdmin(): boolean {
    return this.role === 'ADMIN' || this.role === 'BUILDING_OWNER';
  }

  get isResident(): boolean {
    return this.role === 'RESIDENT';
  }

  login(email: string, password: string): Observable<LoginStep> {
    return this.http
      .post<{
        accessToken?: string;
        twoFactorRequired?: boolean;
        ticket?: string;
      }>(`${environment.apiUrl}/auth/login`, {
        email,
        password,
      })
      .pipe(
        switchMap((res) => {
          if (res.twoFactorRequired && res.ticket) {
            // Second step required; tokens are NOT stored yet.
            return of<LoginStep>({ status: 'two-factor', ticket: res.ticket });
          }
          this.token = res.accessToken ?? null;
          return this.fetchMe().pipe(
            map((user): LoginStep => {
              this.currentUser.set(user);
              this.analytics.identify(user.id);
              this.analytics.capture('login_success');
              return { status: 'signed-in', user };
            }),
          );
        }),
      );
  }

  /** Second login step: redeems the ticket with a TOTP/recovery code. */
  loginWith2fa(ticket: string, token: string): Observable<AuthUser> {
    return this.http
      .post<{ accessToken: string }>(`${environment.apiUrl}/auth/login/2fa`, {
        ticket,
        token,
      })
      .pipe(
        tap((res) => (this.token = res.accessToken)),
        switchMap(() => this.fetchMe()),
        tap((user) => {
          this.currentUser.set(user);
          this.analytics.identify(user.id);
          this.analytics.capture('login_success');
        }),
      );
  }

  register(payload: RegisterPayload): Observable<AuthUser> {
    return this.http
      .post<unknown>(`${environment.apiUrl}/auth/register`, payload)
      .pipe(
        switchMap(() => this.login(payload.email, payload.password)),
        map((step) => {
          // A freshly registered account can never have 2FA enabled.
          if (step.status !== 'signed-in') {
            throw new Error('unexpected 2FA challenge after registration');
          }
          return step.user;
        }),
      );
  }

  refreshAccessToken(): Observable<string> {
    return this.http
      .post<{ accessToken: string }>(
        `${environment.apiUrl}/auth/refresh`,
        {},
      )
      .pipe(
        tap((res) => (this.token = res.accessToken)),
        map((res) => res.accessToken),
      );
  }

  tryRestoreSession(): Observable<AuthUser> {
    return this.refreshAccessToken().pipe(
      switchMap(() => this.fetchMe()),
      tap((user) => this.currentUser.set(user)),
      catchError(() => {
        this.clearSession();
        return throwError(() => new Error('session expired'));
      }),
    );
  }

  fetchMyBuildings(): Observable<MembershipDto[]> {
    return this.http
      .get<MembershipDto[]>(`${environment.apiUrl}/auth/buildings`)
      .pipe(tap((memberships) => this.memberships.set(memberships)));
  }

  /** Feature 7: change password after re-checking the current one. */
  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Observable<void> {
    return this.http
      .post<void>(`${environment.apiUrl}/auth/change-password`, {
        currentPassword,
        newPassword,
      })
      .pipe(map(() => undefined));
  }

  /** Feature 7: change email (re-authenticated; uniqueness enforced). */
  changeEmail(password: string, newEmail: string): Observable<string> {
    return this.http
      .post<{ email: string }>(`${environment.apiUrl}/auth/change-email`, {
        password,
        newEmail,
      })
      .pipe(map((res) => res.email));
  }

  switchBuilding(buildingId: string): Observable<void> {
    return this.http
      .post<{ accessToken: string }>(
        `${environment.apiUrl}/auth/switch-building`,
        { buildingId },
      )
      .pipe(
        tap((res) => (this.token = res.accessToken)),
        map(() => undefined),
      );
  }

  logout(): void {
    this.clearSession();
  }

  private fetchMe(): Observable<AuthUser> {
    return this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`);
  }

  private clearSession(): void {
    this.token = null;
    this.currentUser.set(null);
    this.memberships.set([]);
  }
}
