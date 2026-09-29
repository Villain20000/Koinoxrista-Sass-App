import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ConsumptionDto,
  CreateMeterDto,
  MeterDto,
  MeterReadingDto,
  MetersReadingsMatrixDto,
  UpsertMeterReadingDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MetersApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  list(buildingId: string): Observable<MeterDto[]> {
    return this.http.get<MeterDto[]>(
      `${this.buildingsBase}/${buildingId}/meters`,
    );
  }

  register(buildingId: string, dto: CreateMeterDto): Observable<MeterDto> {
    return this.http.post<MeterDto>(
      `${this.buildingsBase}/${buildingId}/meters`,
      dto,
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiUrl}/meters/${id}`);
  }

  /** Upserts one reading per meter and billing period (`YYYY-MM`). */
  saveReading(
    meterId: string,
    dto: UpsertMeterReadingDto,
  ): Observable<MeterReadingDto> {
    return this.http.post<MeterReadingDto>(
      `${environment.apiUrl}/meters/${meterId}/readings`,
      dto,
    );
  }

  /** Matrix view data for the readings-entry grid (units × kinds). */
  readingsMatrix(
    buildingId: string,
    period: string,
  ): Observable<MetersReadingsMatrixDto> {
    return this.http.get<MetersReadingsMatrixDto>(
      `${this.buildingsBase}/${buildingId}/meters/readings`,
      { params: { period } },
    );
  }

  /** Per-unit consumed values used by the METERS allocation strategy. */
  consumption(
    buildingId: string,
    period: string,
  ): Observable<ConsumptionDto[]> {
    return this.http.get<ConsumptionDto[]>(
      `${this.buildingsBase}/${buildingId}/meters/consumption`,
      { params: { period } },
    );
  }
}
