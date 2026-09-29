import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  PlatformInvoiceDto,
  RunPeriodResponseDto,
} from '@org/shared/lib/self-billing';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SelfBillingApiService {
  private readonly http = inject(HttpClient);

  list(buildingId: string): Observable<PlatformInvoiceDto[]> {
    return this.http.get<PlatformInvoiceDto[]>(
      `${environment.apiUrl}/buildings/${buildingId}/platform-invoices`,
    );
  }

  getOne(buildingId: string, id: string): Observable<PlatformInvoiceDto> {
    return this.http.get<PlatformInvoiceDto>(
      `${environment.apiUrl}/buildings/${buildingId}/platform-invoices/${id}`,
    );
  }

  runPeriod(
    buildingId: string,
    period: string,
  ): Observable<RunPeriodResponseDto> {
    return this.http.post<RunPeriodResponseDto>(
      `${environment.apiUrl}/buildings/${buildingId}/platform-invoices/run-period`,
      { period },
    );
  }
}
