import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * GDPR data-subject rights (Phase 5). Types come from
 * libs/shared/src/lib/gdpr.ts once it is exported from the shared index —
 * until then only primitive-typed signatures are used here.
 */
@Injectable({ providedIn: 'root' })
export class GdprApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/gdpr`;

  /** Downloads the personal-data export as a JSON Blob. */
  download(): Observable<Blob> {
    return this.http.get(`${this.base}/export`, {
      responseType: 'blob' as const,
    });
  }

  deleteMe(confirm: string): Observable<{ anonymized: boolean }> {
    return this.http.post<{ anonymized: boolean }>(
      `${this.base}/delete-me`,
      { confirm },
    );
  }
}
