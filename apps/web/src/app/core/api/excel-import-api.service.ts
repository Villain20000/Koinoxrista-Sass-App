import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  UnitImportPreviewDto,
  UnitImportRequestDto,
} from '@org/shared';
import type { UnitImportResultDto } from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ExcelImportApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  /**
   * Without `confirm` the API answers with a validated dry-run preview;
   * with `confirm: true` it upserts and answers with created/updated counts.
   */
  importUnits(
    buildingId: string,
    dto: UnitImportRequestDto,
  ): Observable<UnitImportPreviewDto | UnitImportResultDto> {
    return this.http.post<UnitImportPreviewDto | UnitImportResultDto>(
      `${this.buildingsBase}/${buildingId}/import-units`,
      dto,
    );
  }
}
