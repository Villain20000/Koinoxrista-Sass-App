import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  EligibilityCheckDto,
  OccupancyDto,
  SetOccupancyDto,
  UpsertEligibilityRuleDto,
  VotingEligibilityRuleDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TenancyApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  /** List occupants for a unit with occupantType + votingEligible */
  occupants(
    buildingId: string,
    unitId: string,
  ): Observable<OccupancyDto[]> {
    return this.http.get<OccupancyDto[]>(
      `${this.base}/${buildingId}/occupancy/${unitId}`,
    );
  }

  /** Upsert occupancy for a unit/user pair */
  setOccupancy(
    buildingId: string,
    unitId: string,
    dto: SetOccupancyDto,
  ): Observable<OccupancyDto> {
    return this.http.put<OccupancyDto>(
      `${this.base}/${buildingId}/occupancy/${unitId}`,
      dto,
    );
  }

  /** All eligibility rules for a building */
  rules(buildingId: string): Observable<VotingEligibilityRuleDto[]> {
    return this.http.get<VotingEligibilityRuleDto[]>(
      `${this.base}/${buildingId}/eligibility-rules`,
    );
  }

  /** Create or update one rule (category is the natural key) */
  upsertRule(
    buildingId: string,
    dto: UpsertEligibilityRuleDto,
  ): Observable<VotingEligibilityRuleDto> {
    return this.http.put<VotingEligibilityRuleDto>(
      `${this.base}/${buildingId}/eligibility-rules`,
      dto,
    );
  }

  /** Check if a unit may vote in a given vote */
  checkEligibility(
    buildingId: string,
    voteId: string,
    unitId: string,
  ): Observable<EligibilityCheckDto> {
    return this.http.get<EligibilityCheckDto>(
      `${this.base}/${buildingId}/votes/${voteId}/eligibility/${unitId}`,
    );
  }
}
