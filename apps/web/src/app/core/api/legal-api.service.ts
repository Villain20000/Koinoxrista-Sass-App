import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AddLegalNoteDto,
  AdvanceLegalCaseDto,
  CloseLegalCaseDto,
  CreateLegalCaseDto,
  LegalCaseDto,
  LegalStatsDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class LegalApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  listCases(
    buildingId: string,
    stage?: string,
    status?: string,
  ): Observable<LegalCaseDto[]> {
    const params: Record<string, string> = {};
    if (stage) params['stage'] = stage;
    if (status) params['status'] = status;
    return this.http.get<LegalCaseDto[]>(`${this.base}/${buildingId}/legal/cases`, { params });
  }

  getCase(buildingId: string, caseId: string): Observable<LegalCaseDto> {
    return this.http.get<LegalCaseDto>(`${this.base}/${buildingId}/legal/cases/${caseId}`);
  }

  createCase(buildingId: string, dto: CreateLegalCaseDto): Observable<LegalCaseDto> {
    return this.http.post<LegalCaseDto>(`${this.base}/${buildingId}/legal/cases`, dto);
  }

  sendNotice(buildingId: string, caseId: string): Observable<{ html: string; case: LegalCaseDto } | LegalCaseDto> {
    return this.http.post<{ html: string; case: LegalCaseDto } | LegalCaseDto>(
      `${this.base}/${buildingId}/legal/cases/${caseId}/send-notice`,
      {},
    );
  }

  advanceStage(
    buildingId: string,
    caseId: string,
    nextStage: string,
  ): Observable<LegalCaseDto> {
    const dto: AdvanceLegalCaseDto = { nextStage };
    return this.http.post<LegalCaseDto>(`${this.base}/${buildingId}/legal/cases/${caseId}/advance`, dto);
  }

  addNote(buildingId: string, caseId: string, note: string): Observable<LegalCaseDto> {
    const dto: AddLegalNoteDto = { note };
    return this.http.post<LegalCaseDto>(`${this.base}/${buildingId}/legal/cases/${caseId}/note`, dto);
  }

  closeCase(buildingId: string, caseId: string, reason?: string): Observable<LegalCaseDto> {
    const dto: CloseLegalCaseDto = { reason };
    return this.http.post<LegalCaseDto>(`${this.base}/${buildingId}/legal/cases/${caseId}/close`, dto);
  }

  getStats(buildingId: string): Observable<LegalStatsDto> {
    return this.http.get<LegalStatsDto>(`${this.base}/${buildingId}/legal/stats`);
  }

  getExodikHtml(buildingId: string, caseId: string): Observable<string> {
    return this.http.get(`${this.base}/${buildingId}/legal/cases/${caseId}/exodik`, {
      responseType: 'text' as const,
    });
  }
}
