import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateOwnershipDto,
  CreateUnitDto,
  Ownership,
  Unit,
} from '@org/shared';
import { environment } from '../../../environments/environment';

/** Unit rows may include owner info joined by the API. */
export interface UnitWithOwners extends Unit {
  owners?: { id: string; email?: string; firstName?: string; lastName?: string }[];
}

@Injectable({ providedIn: 'root' })
export class UnitsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  list(buildingId: string): Observable<UnitWithOwners[]> {
    return this.http.get<UnitWithOwners[]>(`${this.base}/${buildingId}/units`);
  }

  create(buildingId: string, dto: CreateUnitDto): Observable<Unit> {
    return this.http.post<Unit>(`${this.base}/${buildingId}/units`, dto);
  }

  update(
    buildingId: string,
    unitId: string,
    dto: CreateUnitDto,
  ): Observable<Unit> {
    return this.http.put<Unit>(
      `${this.base}/${buildingId}/units/${unitId}`,
      dto,
    );
  }

  addOwnership(unitId: string, dto: CreateOwnershipDto): Observable<Ownership> {
    return this.http.post<Ownership>(
      `${environment.apiUrl}/units/${unitId}/ownerships`,
      dto,
    );
  }
}
