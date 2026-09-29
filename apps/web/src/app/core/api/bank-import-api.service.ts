import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BankImportApplyRequest,
  BankImportApplyResponse,
  BankImportPreviewResponse,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class BankImportApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  preview(buildingId: string, csv: string): Observable<BankImportPreviewResponse> {
    return this.http.post<BankImportPreviewResponse>(
      `${this.buildingsBase}/${buildingId}/bank-import/preview`,
      { csv },
    );
  }

  apply(
    buildingId: string,
    dto: BankImportApplyRequest,
  ): Observable<BankImportApplyResponse> {
    return this.http.post<BankImportApplyResponse>(
      `${this.buildingsBase}/${buildingId}/bank-import/apply`,
      dto,
    );
  }
}
