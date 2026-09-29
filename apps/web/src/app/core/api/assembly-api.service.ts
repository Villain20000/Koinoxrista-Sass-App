import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  AgendaItemDto,
  AttendanceDto,
  AttendanceToggleDto,
  CreateAgendaItemDto,
  PraktikoDto,
  UpdateAgendaItemDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AssemblyApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}`;

  agenda(voteId: string): Observable<AgendaItemDto[]> {
    return this.http.get<AgendaItemDto[]>(`${this.base}/votes/${voteId}/agenda`);
  }

  addAgendaItem(
    voteId: string,
    dto: CreateAgendaItemDto,
  ): Observable<AgendaItemDto> {
    return this.http.post<AgendaItemDto>(
      `${this.base}/votes/${voteId}/agenda`,
      dto,
    );
  }

  updateAgendaItem(
    id: string,
    dto: UpdateAgendaItemDto,
  ): Observable<AgendaItemDto> {
    return this.http.patch<AgendaItemDto>(
      `${this.base}/agenda/${id}`,
      dto,
    );
  }

  deleteAgendaItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/agenda/${id}`);
  }

  /** Units with millimes + present flag (+ remote ballot verification). */
  attendance(voteId: string): Observable<AttendanceDto[]> {
    return this.http.get<AttendanceDto[]>(
      `${this.base}/votes/${voteId}/attendance`,
    );
  }

  toggleAttendance(
    voteId: string,
    dto: AttendanceToggleDto,
  ): Observable<AttendanceDto> {
    return this.http.post<AttendanceDto>(
      `${this.base}/votes/${voteId}/attendance`,
      dto,
    );
  }

  praktiko(voteId: string): Observable<PraktikoDto> {
    return this.http.get<PraktikoDto>(`${this.base}/votes/${voteId}/praktiko`);
  }
}
