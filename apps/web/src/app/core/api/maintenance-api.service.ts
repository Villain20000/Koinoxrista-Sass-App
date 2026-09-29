import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BuildingAssetDto,
  CalendarResponseDto,
  CreateAssetDto,
  CreateScheduleDto,
  GenerateJobsResultDto,
  MaintenanceScheduleDto,
  MarkDoneDto,
  UpdateAssetDto,
  UpdateScheduleDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MaintenanceApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  // ── Assets ──
  listAssets(buildingId: string, category?: string): Observable<BuildingAssetDto[]> {
    const params: Record<string, string> = {};
    if (category) params['category'] = category;
    return this.http.get<BuildingAssetDto[]>(`${this.base}/${buildingId}/assets`, { params });
  }

  createAsset(buildingId: string, dto: CreateAssetDto): Observable<BuildingAssetDto> {
    return this.http.post<BuildingAssetDto>(`${this.base}/${buildingId}/assets`, dto);
  }

  updateAsset(buildingId: string, assetId: string, dto: UpdateAssetDto): Observable<BuildingAssetDto> {
    return this.http.patch<BuildingAssetDto>(`${this.base}/${buildingId}/assets/${assetId}`, dto);
  }

  deleteAsset(buildingId: string, assetId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${buildingId}/assets/${assetId}`);
  }

  // ── Schedules ──
  listSchedules(
    buildingId: string,
    params?: { upcomingDays?: number; category?: string },
  ): Observable<MaintenanceScheduleDto[]> {
    const httpParams: Record<string, string> = {};
    if (params?.upcomingDays !== undefined) httpParams['upcomingDays'] = String(params.upcomingDays);
    if (params?.category) httpParams['category'] = params.category;
    return this.http.get<MaintenanceScheduleDto[]>(`${this.base}/${buildingId}/maintenance/schedules`, {
      params: httpParams,
    });
  }

  createSchedule(buildingId: string, dto: CreateScheduleDto): Observable<MaintenanceScheduleDto> {
    return this.http.post<MaintenanceScheduleDto>(`${this.base}/${buildingId}/maintenance/schedules`, dto);
  }

  updateSchedule(
    buildingId: string,
    scheduleId: string,
    dto: UpdateScheduleDto,
  ): Observable<MaintenanceScheduleDto> {
    return this.http.patch<MaintenanceScheduleDto>(
      `${this.base}/${buildingId}/maintenance/schedules/${scheduleId}`,
      dto,
    );
  }

  deleteSchedule(buildingId: string, scheduleId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${buildingId}/maintenance/schedules/${scheduleId}`);
  }

  markDone(buildingId: string, scheduleId: string, dto: MarkDoneDto = {}): Observable<MaintenanceScheduleDto> {
    return this.http.post<MaintenanceScheduleDto>(
      `${this.base}/${buildingId}/maintenance/schedules/${scheduleId}/done`,
      dto,
    );
  }

  generateJobs(buildingId: string): Observable<GenerateJobsResultDto> {
    return this.http.post<GenerateJobsResultDto>(`${this.base}/${buildingId}/maintenance/generate-jobs`, {});
  }

  getCalendar(
    buildingId: string,
    from?: string,
    to?: string,
  ): Observable<CalendarResponseDto> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.http.get<CalendarResponseDto>(`${this.base}/${buildingId}/maintenance/calendar`, { params });
  }
}
