import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  REFERRAL_STORAGE_KEY,
  RotateReferralCodeResponseDto,
  ReferralInfoDto,
} from '@org/shared/lib/referrals';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ReferralsApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  info(buildingId: string): Observable<ReferralInfoDto> {
    return this.http.get<ReferralInfoDto>(
      `${this.buildingsBase}/${buildingId}/referrals`,
    );
  }

  rotateCode(buildingId: string): Observable<RotateReferralCodeResponseDto> {
    return this.http.post<RotateReferralCodeResponseDto>(
      `${this.buildingsBase}/${buildingId}/referrals/rotate-code`,
      {},
    );
  }

  /** Absolute signup link for the building's current code. */
  referralLink(info: ReferralInfoDto): string {
    return `${info.referralUrlBase}?ref=${info.code ?? ''}`;
  }

  /** Remembers a `?ref=` code between signup and subscription activation. */
  static stashPendingCode(code: string | null | undefined): void {
    const normalized = code?.trim().toUpperCase() ?? '';
    if (normalized) {
      sessionStorage.setItem(REFERRAL_STORAGE_KEY, normalized);
    }
  }

  /** Returns and clears any stashed referral code. */
  static takePendingCode(): string | null {
    const code = sessionStorage.getItem(REFERRAL_STORAGE_KEY);
    if (code) {
      sessionStorage.removeItem(REFERRAL_STORAGE_KEY);
    }
    return code;
  }
}
