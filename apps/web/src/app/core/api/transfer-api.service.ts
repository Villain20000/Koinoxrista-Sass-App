import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BuildingExportPayload, BuildingImportResult } from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TransferApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  /** GETs the building backup JSON as a full Blob HTTP response. */
  export(buildingId: string): Observable<HttpResponse<Blob>> {
    return this.http.get(
      `${this.buildingsBase}/${buildingId}/transfer/export`,
      { responseType: 'blob' as const, observe: 'response' },
    );
  }

  /** POSTs a transfer payload; creates a NEW building. */
  import(payload: BuildingExportPayload): Observable<BuildingImportResult> {
    return this.http.post<BuildingImportResult>(
      `${environment.apiUrl}/transfer/import`,
      { payload },
    );
  }
}
