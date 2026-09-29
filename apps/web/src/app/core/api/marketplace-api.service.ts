import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CommissionSummaryDto,
  CreateFeaturedSlotDto,
  FeaturedSlotDto,
  JobCommissionDto,
  JobCommissionStatus,
} from '@org/shared';
import { environment } from '../../../environments/environment';

/** Greek label for a commission status chip. */
export function commissionStatusLabel(status: JobCommissionStatus): string {
  switch (status) {
    case 'PAID':
      return 'Εξοφλημένη';
    case 'WAIVED':
      return 'Παραβλέφθηκε';
    default:
      return 'Οφειλόμενη';
  }
}

/** Marketplace monetization endpoints (commissions + featured placements). */
@Injectable({ providedIn: 'root' })
export class MarketplaceApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  commissions(
    buildingId: string,
    status?: JobCommissionStatus,
  ): Observable<JobCommissionDto[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    return this.http.get<JobCommissionDto[]>(
      `${this.buildingsBase}/${buildingId}/commissions`,
      { params },
    );
  }

  /** Yearly monthly volume (`year` omitted → current year server-side). */
  commissionSummary(buildingId: string, year?: number): Observable<CommissionSummaryDto> {
    let params = new HttpParams();
    if (year) params = params.set('year', String(year));
    return this.http.get<CommissionSummaryDto>(
      `${this.buildingsBase}/${buildingId}/commissions/summary`,
      { params },
    );
  }

  markPaid(id: string): Observable<JobCommissionDto> {
    return this.http.post<JobCommissionDto>(
      `${environment.apiUrl}/commissions/${id}/mark-paid`,
      {},
    );
  }

  waive(id: string): Observable<JobCommissionDto> {
    return this.http.post<JobCommissionDto>(
      `${environment.apiUrl}/commissions/${id}/waive`,
      {},
    );
  }

  featuredSlots(buildingId: string): Observable<FeaturedSlotDto[]> {
    return this.http.get<FeaturedSlotDto[]>(
      `${this.buildingsBase}/${buildingId}/featured-slots`,
    );
  }

  createFeaturedSlot(
    buildingId: string,
    dto: CreateFeaturedSlotDto,
  ): Observable<FeaturedSlotDto> {
    return this.http.post<FeaturedSlotDto>(
      `${this.buildingsBase}/${buildingId}/featured-slots`,
      dto,
    );
  }

  deleteFeaturedSlot(buildingId: string, slotId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.buildingsBase}/${buildingId}/featured-slots/${slotId}`,
    );
  }
}
