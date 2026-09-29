import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateRecurringExpenseDto,
  GenerateRecurringResultDto,
  RecurringExpenseDto,
  UpdateRecurringExpenseDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class RecurringApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  list(buildingId: string): Observable<RecurringExpenseDto[]> {
    return this.http.get<RecurringExpenseDto[]>(
      `${this.buildingsBase}/${buildingId}/recurring`,
    );
  }

  create(
    buildingId: string,
    dto: CreateRecurringExpenseDto,
  ): Observable<RecurringExpenseDto> {
    return this.http.post<RecurringExpenseDto>(
      `${this.buildingsBase}/${buildingId}/recurring`,
      dto,
    );
  }

  update(
    buildingId: string,
    id: string,
    dto: UpdateRecurringExpenseDto,
  ): Observable<RecurringExpenseDto> {
    return this.http.patch<RecurringExpenseDto>(
      `${this.buildingsBase}/${buildingId}/recurring/${id}`,
      dto,
    );
  }

  delete(buildingId: string, id: string): Observable<void> {
    return this.http.delete<void>(
      `${this.buildingsBase}/${buildingId}/recurring/${id}`,
    );
  }

  generate(
    buildingId: string,
    periodYearMonth: string,
  ): Observable<GenerateRecurringResultDto> {
    return this.http.post<GenerateRecurringResultDto>(
      `${this.buildingsBase}/${buildingId}/recurring/generate`,
      { periodYearMonth },
    );
  }
}
