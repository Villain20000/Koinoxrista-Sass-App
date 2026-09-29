import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ArrearsReport,
  Building,
  CreateBuildingDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

export interface ReminderPreview {
  recipients: string[];
  subject: string;
}

export interface ReminderSendResult {
  sent: number;
}

@Injectable({ providedIn: 'root' })
export class BuildingsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  mine(): Observable<Building> {
    return this.http.get<Building>(`${this.base}/mine`);
  }

  create(dto: CreateBuildingDto): Observable<Building> {
    return this.http.post<Building>(this.base, dto);
  }

  arrears(buildingId: string): Observable<ArrearsReport> {
    return this.http.get<ArrearsReport>(`${this.base}/${buildingId}/arrears`);
  }

  previewReminders(
    buildingId: string,
    periodYearMonth?: string,
  ): Observable<ReminderPreview> {
    return this.http.post<ReminderPreview>(
      `${this.base}/${buildingId}/reminders/preview`,
      periodYearMonth ? { periodYearMonth } : {},
    );
  }

  sendReminders(
    buildingId: string,
    periodYearMonth?: string,
  ): Observable<ReminderSendResult> {
    return this.http.post<ReminderSendResult>(
      `${this.base}/${buildingId}/reminders/send`,
      periodYearMonth ? { periodYearMonth } : {},
    );
  }

  ledgerCsv(buildingId: string, year: number): Observable<Blob> {
    return this.http.get(`${this.base}/${buildingId}/export/ledger.csv`, {
      params: { year: String(year) },
      responseType: 'blob' as const,
    });
  }

  arrearsCsv(buildingId: string): Observable<Blob> {
    return this.http.get(`${this.base}/${buildingId}/export/arrears.csv`, {
      responseType: 'blob' as const,
    });
  }

  updateSettings(
    buildingId: string,
    dto: { invoiceRegistrationNo?: string; market?: string; currency?: string; pspProvider?: string },
  ): Observable<Building> {
    return this.http.patch<Building>(`${this.base}/${buildingId}/settings`, dto);
  }
}
