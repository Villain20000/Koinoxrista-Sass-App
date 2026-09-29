import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreatePaymentPlanDto,
  PaymentPlanDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

/** Greek label for a plan lifecycle status. */
export function paymentPlanStatusLabel(status: PaymentPlanDto['status']): string {
  switch (status) {
    case 'COMPLETED':
      return 'Ολοκληρωμένο';
    case 'CANCELLED':
      return 'Ακυρωμένο';
    default:
      return 'Ενεργό';
  }
}

/** Tailwind classes for a plan status chip. */
export function paymentPlanStatusCls(status: PaymentPlanDto['status']): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-green-100 text-green-800';
    case 'CANCELLED':
      return 'bg-slate-200 text-slate-700';
    default:
      return 'bg-blue-100 text-blue-800';
  }
}

@Injectable({ providedIn: 'root' })
export class PaymentPlansApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  create(buildingId: string, dto: CreatePaymentPlanDto): Observable<PaymentPlanDto> {
    return this.http.post<PaymentPlanDto>(
      `${this.buildingsBase}/${buildingId}/payment-plans`,
      dto,
    );
  }

  list(buildingId: string, status?: string): Observable<PaymentPlanDto[]> {
    const params = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.http.get<PaymentPlanDto[]>(
      `${this.buildingsBase}/${buildingId}/payment-plans${params}`,
    );
  }

  /** Full schedule of one plan with running totals. */
  get(id: string): Observable<PaymentPlanDto> {
    return this.http.get<PaymentPlanDto>(`${environment.apiUrl}/payment-plans/${id}`);
  }

  recordPayment(id: string, amountCents: number): Observable<PaymentPlanDto> {
    return this.http.post<PaymentPlanDto>(
      `${environment.apiUrl}/payment-plans/${id}/payments`,
      { amountCents },
    );
  }

  cancel(id: string): Observable<PaymentPlanDto> {
    return this.http.post<PaymentPlanDto>(
      `${environment.apiUrl}/payment-plans/${id}/cancel`,
      {},
    );
  }

  /** RESIDENT read-only view of their own unit's active plan. */
  myPlan(): Observable<PaymentPlanDto> {
    return this.http.get<PaymentPlanDto>(
      `${environment.apiUrl}/balance/payment-plan`,
    );
  }
}
