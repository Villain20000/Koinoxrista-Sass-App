import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface StatementRow {
  periodYearMonth: string;
  description: string;
  invoicedCents: number;
  paidCents: number;
}

export interface ResidentStatement {
  buildingName: string;
  unitLabel: string;
  ownerName?: string;
  year: string;
  rows: StatementRow[];
  totals: {
    invoicedCents: number;
    paidCents: number;
    balanceCents: number;
  };
}

@Injectable({ providedIn: 'root' })
export class StatementsApiService {
  private readonly http = inject(HttpClient);

  mine(year: string): Observable<ResidentStatement> {
    return this.http.get<ResidentStatement>(
      `${environment.apiUrl}/statements/mine/year/${year}`,
    );
  }
}
