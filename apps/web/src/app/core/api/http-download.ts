import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Triggers a browser download of a Blob via a temporary anchor element. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** GETs an endpoint as a Blob (for CSV / file downloads). */
export function fetchBlob(http: HttpClient, url: string): Observable<Blob> {
  return http.get(url, { responseType: 'blob' as const });
}
