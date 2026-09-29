import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BuildingDocument } from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DocumentsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}`;

  list(buildingId: string): Observable<BuildingDocument[]> {
    return this.http.get<BuildingDocument[]>(
      `${this.base}/buildings/${buildingId}/documents`,
    );
  }

  upload(buildingId: string, file: File, type: string): Observable<BuildingDocument> {
    const form = new FormData();
    form.set('file', file);
    form.set('type', type);
    return this.http.post<BuildingDocument>(
      `${this.base}/buildings/${buildingId}/documents`,
      form,
    );
  }

  download(documentId: string): Observable<Blob> {
    return this.http.get(`${this.base}/documents/${documentId}/download`, {
      responseType: 'blob' as const,
    });
  }

  delete(documentId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/documents/${documentId}`);
  }
}
