import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreatePartnerLeadDto,
  LeadStatusDto,
  PartnerLeadDto,
  PartnerSummaryDto,
  UpdatePartnerLeadDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PartnersApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;
  private readonly leadsBase = `${environment.apiUrl}/partner-leads`;

  list(
    buildingId: string,
    status?: string,
    category?: string,
  ): Observable<PartnerLeadDto[]> {
    const params: Record<string, string> = {};
    if (status) params['status'] = status;
    if (category) params['category'] = category;
    return this.http.get<PartnerLeadDto[]>(
      `${this.buildingsBase}/${buildingId}/partner-leads`,
      { params },
    );
  }

  summary(buildingId: string, year?: number): Observable<PartnerSummaryDto> {
    const params: Record<string, string> = {};
    if (year !== undefined) params['year'] = String(year);
    return this.http.get<PartnerSummaryDto>(
      `${this.buildingsBase}/${buildingId}/partner-leads/summary`,
      { params },
    );
  }

  create(buildingId: string, dto: CreatePartnerLeadDto): Observable<PartnerLeadDto> {
    return this.http.post<PartnerLeadDto>(
      `${this.buildingsBase}/${buildingId}/partner-leads`,
      dto,
    );
  }

  update(id: string, dto: UpdatePartnerLeadDto): Observable<PartnerLeadDto> {
    return this.http.patch<PartnerLeadDto>(`${this.leadsBase}/${id}`, dto);
  }

  changeStatus(id: string, dto: LeadStatusDto): Observable<PartnerLeadDto> {
    return this.http.post<PartnerLeadDto>(`${this.leadsBase}/${id}/status`, dto);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.leadsBase}/${id}`);
  }
}
