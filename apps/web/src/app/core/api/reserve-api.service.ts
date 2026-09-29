import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateContributionDto,
  CreateDrawdownDto,
  CreateLevyDto,
  ExtraordinaryLevyDto,
  ReserveFundDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ReserveApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  getFund(buildingId: string): Observable<ReserveFundDto> {
    return this.http.get<ReserveFundDto>(
      `${this.base}/${buildingId}/reserve/fund`,
    );
  }

  updateTarget(
    buildingId: string,
    targetCents: number,
  ): Observable<ReserveFundDto> {
    return this.http.patch<ReserveFundDto>(
      `${this.base}/${buildingId}/reserve/target`,
      { targetCents },
    );
  }

  contribute(
    buildingId: string,
    dto: CreateContributionDto,
  ): Observable<{ contribution: { id: string }; fund: ReserveFundDto }> {
    return this.http.post<{ contribution: { id: string }; fund: ReserveFundDto }>(
      `${this.base}/${buildingId}/reserve/contribute`,
      dto,
    );
  }

  drawdown(
    buildingId: string,
    dto: CreateDrawdownDto,
  ): Observable<{ drawdown: { id: string }; fund: ReserveFundDto }> {
    return this.http.post<{ drawdown: { id: string }; fund: ReserveFundDto }>(
      `${this.base}/${buildingId}/reserve/drawdown`,
      dto,
    );
  }

  listLevies(buildingId: string): Observable<ExtraordinaryLevyDto[]> {
    return this.http.get<ExtraordinaryLevyDto[]>(
      `${this.base}/${buildingId}/reserve/levies`,
    );
  }

  createLevy(
    buildingId: string,
    dto: CreateLevyDto,
  ): Observable<ExtraordinaryLevyDto> {
    return this.http.post<ExtraordinaryLevyDto>(
      `${this.base}/${buildingId}/reserve/levies`,
      dto,
    );
  }

  getLevy(
    buildingId: string,
    levyId: string,
  ): Observable<ExtraordinaryLevyDto> {
    return this.http.get<ExtraordinaryLevyDto>(
      `${this.base}/${buildingId}/reserve/levies/${levyId}`,
    );
  }

  issueLevy(
    buildingId: string,
    levyId: string,
  ): Observable<ExtraordinaryLevyDto> {
    return this.http.post<ExtraordinaryLevyDto>(
      `${this.base}/${buildingId}/reserve/levies/${levyId}/issue`,
      {},
    );
  }

  closeLevy(
    buildingId: string,
    levyId: string,
  ): Observable<ExtraordinaryLevyDto> {
    return this.http.post<ExtraordinaryLevyDto>(
      `${this.base}/${buildingId}/reserve/levies/${levyId}/close`,
      {},
    );
  }
}

/** Greek helpers re-exported for templates. */
export {
  levyStrategyLabel,
  levyStatusLabel,
  contributionSourceLabel,
} from '@org/shared';
