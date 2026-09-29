import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Provider row shown in the admin directory (no contact details). */
export interface ProviderDirectoryItem {
  userId: string;
  firstName: string;
  lastName: string;
  trade: string;
  certs: string[];
  rating: number | null;
  city: string | null;
  bio: string | null;
  hourlyRateCents: number | null;
  completedJobs: number;
  avgRating: number | null;
}

/** Contact details, exposed only to admins/staff. */
export interface ProviderContact {
  phone: string;
  email: string;
}

/** Directory item plus contact info (contact is null for residents). */
export interface ProviderDetail extends ProviderDirectoryItem {
  contact: ProviderContact | null;
}

export interface ProviderSearchFilters {
  q?: string;
  trade?: string;
  city?: string;
  minRating?: number | null;
}

@Injectable({ providedIn: 'root' })
export class ProvidersApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/providers`;

  search(filters: ProviderSearchFilters = {}): Observable<ProviderDirectoryItem[]> {
    let params = new HttpParams();
    const q = filters.q?.trim();
    if (q) params = params.set('q', q);
    const trade = filters.trade?.trim();
    if (trade) params = params.set('trade', trade);
    const city = filters.city?.trim();
    if (city) params = params.set('city', city);
    const minRating = filters.minRating;
    if (minRating != null && minRating > 0) {
      params = params.set('minRating', String(minRating));
    }
    return this.http.get<ProviderDirectoryItem[]>(this.base, { params });
  }

  detail(userId: string): Observable<ProviderDetail> {
    return this.http.get<ProviderDetail>(`${this.base}/${userId}`);
  }
}
