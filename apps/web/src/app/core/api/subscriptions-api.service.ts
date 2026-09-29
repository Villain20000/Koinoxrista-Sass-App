import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ChangeTierDto, FeatureFlags, SubscriptionDto } from '@org/shared';
import { ReferralsApiService } from './referrals-api.service';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SubscriptionsApiService {
  private readonly http = inject(HttpClient);

  get(): Observable<SubscriptionDto> {
    return this.http.get<SubscriptionDto>(
      `${environment.apiUrl}/subscriptions`,
    );
  }

  changeTier(dto: ChangeTierDto): Observable<SubscriptionDto> {
    return this.http.put<SubscriptionDto>(
      `${environment.apiUrl}/subscriptions/tier`,
      dto,
    );
  }

  activate(): Observable<SubscriptionDto> {
    // Handoff: a code captured at /register?ref=… is sent once the building
    // actually activates, then cleared so it can never be redeemed twice.
    const referralCode = ReferralsApiService.takePendingCode();
    return this.http.post<SubscriptionDto>(
      `${environment.apiUrl}/subscriptions/activate`,
      referralCode ? { referralCode } : {},
    );
  }

  cancel(): Observable<SubscriptionDto> {
    return this.http.post<SubscriptionDto>(
      `${environment.apiUrl}/subscriptions/cancel`,
      {},
    );
  }

  features(): Observable<FeatureFlags> {
    return this.http.get<FeatureFlags>(
      `${environment.apiUrl}/subscriptions/features`,
    );
  }
}
