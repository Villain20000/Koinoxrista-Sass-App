import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface ReportPeriodPoint {
  periodYearMonth: string;
  invoicedCents: number;
  collectedCents: number;
  arrearsCents: number;
}

export interface ReportCategoryTotal {
  categoryName: string;
  totalCents: number;
}

export interface ReportSummary {
  periods: ReportPeriodPoint[];
  expensesByCategory: ReportCategoryTotal[];
  totals: {
    invoicedCents: number;
    collectedCents: number;
    arrearsCents: number;
    collectionRatePct: number;
  };
}

@Injectable({ providedIn: 'root' })
export class ReportsApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  summary(buildingId: string, months?: number): Observable<ReportSummary> {
    const params: Record<string, string> = {};
    if (months) params['months'] = String(months);
    return this.http.get<ReportSummary>(
      `${this.buildingsBase}/${buildingId}/reports/summary`,
      { params },
    );
  }
}
