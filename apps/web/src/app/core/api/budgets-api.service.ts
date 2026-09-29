import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BudgetCompareResponseDto,
  BudgetLineDto,
  CreateBudgetLineDto,
  UpdateBudgetLineDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class BudgetsApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  list(buildingId: string, year: number): Observable<BudgetLineDto[]> {
    return this.http.get<BudgetLineDto[]>(
      `${this.buildingsBase}/${buildingId}/budgets/${year}`,
    );
  }

  compare(
    buildingId: string,
    year: number,
  ): Observable<BudgetCompareResponseDto> {
    return this.http.get<BudgetCompareResponseDto>(
      `${this.buildingsBase}/${buildingId}/budgets/${year}/compare`,
    );
  }

  create(
    buildingId: string,
    dto: CreateBudgetLineDto,
  ): Observable<BudgetLineDto> {
    return this.http.post<BudgetLineDto>(
      `${this.buildingsBase}/${buildingId}/budgets`,
      dto,
    );
  }

  update(id: string, dto: UpdateBudgetLineDto): Observable<BudgetLineDto> {
    return this.http.patch<BudgetLineDto>(
      `${environment.apiUrl}/budgets/${id}`,
      dto,
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/budgets/${id}`);
  }
}
