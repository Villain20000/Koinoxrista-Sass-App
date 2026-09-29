import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CreateExpenseCategoryDto, ExpenseCategory } from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class CategoriesApiService {
  private readonly http = inject(HttpClient);

  list(buildingId: string): Observable<ExpenseCategory[]> {
    return this.http.get<ExpenseCategory[]>(
      `${environment.apiUrl}/buildings/${buildingId}/categories`,
    );
  }

  create(
    buildingId: string,
    dto: CreateExpenseCategoryDto,
  ): Observable<ExpenseCategory> {
    return this.http.post<ExpenseCategory>(
      `${environment.apiUrl}/buildings/${buildingId}/categories`,
      dto,
    );
  }
}
