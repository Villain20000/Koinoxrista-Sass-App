import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CheckExpiriesResultDto,
  ComplianceItemDto,
  CreateComplianceDto,
  UpdateComplianceDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ComplianceApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;
  private readonly complianceBase = `${environment.apiUrl}/compliance`;

  list(
    buildingId: string,
    kind?: string,
    upcomingDays?: number,
  ): Observable<ComplianceItemDto[]> {
    const params: Record<string, string> = {};
    if (kind) params['kind'] = kind;
    if (upcomingDays !== undefined) params['upcomingDays'] = String(upcomingDays);
    return this.http.get<ComplianceItemDto[]>(
      `${this.buildingsBase}/${buildingId}/compliance`,
      { params },
    );
  }

  create(buildingId: string, dto: CreateComplianceDto): Observable<ComplianceItemDto> {
    return this.http.post<ComplianceItemDto>(
      `${this.buildingsBase}/${buildingId}/compliance`,
      dto,
    );
  }

  update(id: string, dto: UpdateComplianceDto): Observable<ComplianceItemDto> {
    return this.http.patch<ComplianceItemDto>(`${this.complianceBase}/${id}`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.complianceBase}/${id}`);
  }

  checkExpiries(buildingId: string): Observable<CheckExpiriesResultDto> {
    return this.http.post<CheckExpiriesResultDto>(
      `${this.buildingsBase}/${buildingId}/compliance/check-expiries`,
      {},
    );
  }
}
