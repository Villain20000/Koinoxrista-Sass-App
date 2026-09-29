import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  LateFeeChargeDto,
  LateFeeRunResultDto,
  LateFeeSettingsDto,
  UpdateLateFeeSettingsDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

/** Greek label for a late-fee accrual mode. */
export function lateFeeModeLabel(mode: LateFeeSettingsDto['mode']): string {
  return mode === 'PERCENT'
    ? 'Ποσοστό υπολοίπου ανά ημέρα'
    : 'Ποσό ανά ημέρα';
}

@Injectable({ providedIn: 'root' })
export class LateFeesApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  settings(buildingId: string): Observable<LateFeeSettingsDto> {
    return this.http.get<LateFeeSettingsDto>(
      `${this.buildingsBase}/${buildingId}/late-fees/settings`,
    );
  }

  updateSettings(
    buildingId: string,
    dto: UpdateLateFeeSettingsDto,
  ): Observable<LateFeeSettingsDto> {
    return this.http.put<LateFeeSettingsDto>(
      `${this.buildingsBase}/${buildingId}/late-fees/settings`,
      dto,
    );
  }

  /** Runs the sweep; `month` (`YYYY-MM`) optionally narrows the scope. */
  run(buildingId: string, month?: string): Observable<LateFeeRunResultDto> {
    return this.http.post<LateFeeRunResultDto>(
      `${this.buildingsBase}/${buildingId}/late-fees/run`,
      month ? { month } : {},
    );
  }

  list(buildingId: string): Observable<LateFeeChargeDto[]> {
    return this.http.get<LateFeeChargeDto[]>(
      `${this.buildingsBase}/${buildingId}/late-fees`,
    );
  }

  waive(id: string): Observable<LateFeeChargeDto> {
    return this.http.post<LateFeeChargeDto>(
      `${environment.apiUrl}/late-fees/${id}/waive`,
      {},
    );
  }
}
