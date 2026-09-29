import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  BuildingBrandingDto,
  PublicBrandingDto,
  UpdateBrandingDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

/** Applied when branding was never configured (matches API/DB defaults). */
export const DEFAULT_PUBLIC_BRANDING: Omit<PublicBrandingDto, 'buildingId'> = {
  logoUrl: null,
  primaryColor: '#1e40af',
  accentColor: '#0ea5e9',
  orgName: null,
  footerText: null,
};

@Injectable({ providedIn: 'root' })
export class BrandingApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;
  private readonly publicBase = `${environment.apiUrl}/public/buildings`;

  get(buildingId: string): Observable<BuildingBrandingDto> {
    return this.http.get<BuildingBrandingDto>(
      `${this.buildingsBase}/${buildingId}/branding`,
    );
  }

  update(
    buildingId: string,
    dto: UpdateBrandingDto,
  ): Observable<BuildingBrandingDto> {
    return this.http.put<BuildingBrandingDto>(
      `${this.buildingsBase}/${buildingId}/branding`,
      dto,
    );
  }

  /** Unauthenticated; used by print pages for branded headers. */
  getPublic(buildingId: string): Observable<PublicBrandingDto> {
    return this.http.get<PublicBrandingDto>(
      `${this.publicBase}/${buildingId}/branding`,
    );
  }
}
