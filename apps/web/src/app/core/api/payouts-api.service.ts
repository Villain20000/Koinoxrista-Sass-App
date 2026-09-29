import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateSupplierPaymentDto,
  PayoutSummaryDto,
  SupplierPaymentDto,
  SupplierPaymentMethod,
  UpdateSupplierPaymentDto,
  MyPayoutDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

/** Greek label for a payout method. */
export function supplierPaymentMethodLabel(method: SupplierPaymentMethod): string {
  switch (method) {
    case 'BANK':
      return 'Τράπεζα';
    case 'CASH':
      return 'Μετρητά';
    case 'CHECK':
      return 'Επιταγή';
    default:
      return 'Κάρτα';
  }
}

@Injectable({ providedIn: 'root' })
export class PayoutsApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  list(buildingId: string, year?: string, jobId?: string): Observable<SupplierPaymentDto[]> {
    const params: Record<string, string> = {};
    if (year) params['year'] = year;
    if (jobId) params['jobId'] = jobId;
    return this.http.get<SupplierPaymentDto[]>(
      `${this.buildingsBase}/${buildingId}/payouts`,
      { params },
    );
  }

  summary(buildingId: string, year?: string): Observable<PayoutSummaryDto> {
    const params: Record<string, string> = {};
    if (year) params['year'] = year;
    return this.http.get<PayoutSummaryDto>(
      `${this.buildingsBase}/${buildingId}/payouts/summary`,
      { params },
    );
  }

  create(buildingId: string, dto: CreateSupplierPaymentDto): Observable<SupplierPaymentDto> {
    return this.http.post<SupplierPaymentDto>(
      `${this.buildingsBase}/${buildingId}/payouts`,
      dto,
    );
  }

  update(id: string, dto: UpdateSupplierPaymentDto): Observable<SupplierPaymentDto> {
    return this.http.patch<SupplierPaymentDto>(
      `${environment.apiUrl}/payouts/${id}`,
      dto,
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/payouts/${id}`);
  }

  /** PROVIDER: payouts on jobs awarded to the current provider. */
  mine(): Observable<MyPayoutDto[]> {
    return this.http.get<MyPayoutDto[]>(`${environment.apiUrl}/payouts/mine`);
  }
}
