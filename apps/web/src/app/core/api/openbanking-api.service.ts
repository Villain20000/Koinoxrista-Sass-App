import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  BankConnectionDto,
  CreateBankConnectionRequest,
  ImportedTransactionSuggestionDto,
  SyncResultDto,
} from '@org/shared/lib/openbanking';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OpenBankingApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;
  private readonly connectionsBase = `${environment.apiUrl}/bank-connections`;

  list(buildingId: string): Observable<BankConnectionDto[]> {
    return this.http.get<BankConnectionDto[]>(
      `${this.buildingsBase}/${buildingId}/bank-connections`,
    );
  }

  create(
    buildingId: string,
    dto: CreateBankConnectionRequest,
  ): Observable<BankConnectionDto> {
    return this.http.post<BankConnectionDto>(
      `${this.buildingsBase}/${buildingId}/bank-connections`,
      dto,
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.connectionsBase}/${id}`);
  }

  sync(id: string): Observable<SyncResultDto> {
    return this.http.post<SyncResultDto>(
      `${this.connectionsBase}/${id}/sync`,
      {},
    );
  }

  transactions(id: string): Observable<ImportedTransactionSuggestionDto[]> {
    return this.http.get<ImportedTransactionSuggestionDto[]>(
      `${this.connectionsBase}/${id}/transactions`,
    );
  }
}
