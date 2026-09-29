import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Invoice, RunInvoicesDto } from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InvoicesApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  run(buildingId: string, dto: RunInvoicesDto): Observable<Invoice[]> {
    return this.http.post<Invoice[]>(
      `${this.buildingsBase}/${buildingId}/invoices/run`,
      dto,
    );
  }

  list(buildingId: string, period?: string): Observable<Invoice[]> {
    const params: Record<string, string> = {};
    if (period) params["periodYearMonth"] = period;
    return this.http.get<Invoice[]>(
      `${this.buildingsBase}/${buildingId}/invoices`,
      { params },
    );
  }

  mine(period?: string): Observable<Invoice[]> {
    const params: Record<string, string> = {};
    if (period) params["periodYearMonth"] = period;
    return this.http.get<Invoice[]>(`${environment.apiUrl}/invoices/mine`, {
      params,
    });
  }
}
