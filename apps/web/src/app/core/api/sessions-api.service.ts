import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Wire type for GET /auth/sessions (one active refresh session). */
export interface ActiveSessionDto {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
  ip: string | null;
  /** True when this row belongs to the calling browser's refresh cookie. */
  isCurrent: boolean;
}

/** List/revoke the account's active sessions ("your active sessions" card). */
@Injectable({ providedIn: 'root' })
export class SessionsApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<ActiveSessionDto[]> {
    return this.http.get<ActiveSessionDto[]>(
      `${environment.apiUrl}/auth/sessions`,
    );
  }

  revoke(sessionId: string): Observable<void> {
    return this.http.delete<void>(
      `${environment.apiUrl}/auth/sessions/${sessionId}`,
    );
  }

  revokeOthers(): Observable<{ revoked: number }> {
    return this.http.post<{ revoked: number }>(
      `${environment.apiUrl}/auth/sessions/revoke-others`,
      {},
    );
  }
}
