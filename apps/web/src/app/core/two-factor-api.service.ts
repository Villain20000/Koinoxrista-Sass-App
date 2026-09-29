import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Wire types for the 2FA endpoints (mirror libs/shared/src/lib/two-factor.ts
 * until its barrel export lands).
 */
export interface TwoFactorSetup {
  /** base32 secret — type it into the authenticator app or scan otpauthUri. */
  secret: string;
  otpauthUri: string;
}

export interface TwoFactorEnabled {
  recoveryCodes: string[];
}

/** Setup/enable/disable calls for the security settings page. */
@Injectable({ providedIn: 'root' })
export class TwoFactorApiService {
  private readonly http = inject(HttpClient);

  setup(): Observable<TwoFactorSetup> {
    return this.http.post<TwoFactorSetup>(
      `${environment.apiUrl}/auth/2fa/setup`,
      {},
    );
  }

  enable(secret: string, token: string): Observable<TwoFactorEnabled> {
    return this.http
      .post<{ enabled: boolean; recoveryCodes: string[] }>(
        `${environment.apiUrl}/auth/2fa/enable`,
        { secret, token },
      )
      .pipe(map((res) => ({ recoveryCodes: res.recoveryCodes })));
  }

  disable(password: string): Observable<void> {
    return this.http
      .post<{ twoFactorEnabled: boolean }>(
        `${environment.apiUrl}/auth/2fa/disable`,
        { password },
      )
      .pipe(map(() => undefined));
  }
}
