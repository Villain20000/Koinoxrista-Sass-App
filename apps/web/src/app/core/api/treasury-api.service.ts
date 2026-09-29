import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateTreasuryAccountDto,
  CreateTreasuryEntryDto,
  TreasuryAccountDto,
  TreasuryBalanceDto,
  TreasuryEntriesResponseDto,
  TreasuryEntryDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TreasuryApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;

  listAccounts(buildingId: string): Observable<TreasuryAccountDto[]> {
    return this.http.get<TreasuryAccountDto[]>(
      `${this.buildingsBase}/${buildingId}/treasury/accounts`,
    );
  }

  createAccount(
    buildingId: string,
    dto: CreateTreasuryAccountDto,
  ): Observable<TreasuryAccountDto> {
    return this.http.post<TreasuryAccountDto>(
      `${this.buildingsBase}/${buildingId}/treasury/accounts`,
      dto,
    );
  }

  listEntries(
    buildingId: string,
    filters: {
      accountId?: string;
      from?: string;
      to?: string;
      skip?: number;
      take?: number;
    } = {},
  ): Observable<TreasuryEntriesResponseDto> {
    const params: Record<string, string> = {};
    if (filters.accountId) params['accountId'] = filters.accountId;
    if (filters.from) params['from'] = filters.from;
    if (filters.to) params['to'] = filters.to;
    if (filters.skip !== undefined) params['skip'] = String(filters.skip);
    if (filters.take !== undefined) params['take'] = String(filters.take);
    return this.http.get<TreasuryEntriesResponseDto>(
      `${this.buildingsBase}/${buildingId}/treasury/entries`,
      { params },
    );
  }

  createEntry(
    buildingId: string,
    dto: CreateTreasuryEntryDto,
  ): Observable<TreasuryEntryDto> {
    return this.http.post<TreasuryEntryDto>(
      `${this.buildingsBase}/${buildingId}/treasury/entries`,
      dto,
    );
  }

  getBalance(buildingId: string): Observable<TreasuryBalanceDto> {
    return this.http.get<TreasuryBalanceDto>(
      `${this.buildingsBase}/${buildingId}/treasury/balance`,
    );
  }
}

/** Greek label for a treasury direction. */
export function treasuryDirectionLabel(direction: string): string {
  return direction === 'IN' ? 'Εισροή' : 'Εκροή';
}

/** Greek label for a treasury method. */
export function treasuryMethodLabel(method: string): string {
  switch (method) {
    case 'CASH':
      return 'Μετρητά';
    case 'BANK':
      return 'Τράπεζα';
    case 'CHECK':
      return 'Επιταγή';
    case 'CARD':
      return 'Κάρτα';
    default:
      return method;
  }
}

/** Greek label for an account type. */
export function treasuryAccountTypeLabel(type: string): string {
  return type === 'CASH' ? 'Μετρητά (Ταμείο)' : 'Τράπεζα';
}
