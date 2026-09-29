import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CreateExpenseDto, Expense } from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ExpensesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  list(buildingId: string, period?: string): Observable<Expense[]> {
    const params: Record<string, string> = {};
    if (period) params["periodYearMonth"] = period;
    return this.http.get<Expense[]>(`${this.base}/${buildingId}/expenses`, {
      params,
    });
  }

  create(buildingId: string, dto: CreateExpenseDto): Observable<Expense> {
    return this.http.post<Expense>(`${this.base}/${buildingId}/expenses`, dto);
  }
}
