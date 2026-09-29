import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateInviteDto,
  InviteDto,
  InviteWithTokenResponse,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class InvitesApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/buildings`;

  list(buildingId: string): Observable<InviteDto[]> {
    return this.http.get<InviteDto[]>(`${this.base}/${buildingId}/invites`);
  }

  create(
    buildingId: string,
    dto: CreateInviteDto,
  ): Observable<InviteWithTokenResponse> {
    return this.http.post<InviteWithTokenResponse>(
      `${this.base}/${buildingId}/invites`,
      dto,
    );
  }

  revoke(inviteId: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(
      `${environment.apiUrl}/invites/${inviteId}`,
    );
  }
}
