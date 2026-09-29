import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuditLogPage, AuditQueryDto } from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuditApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/audit`;

  list(query: AuditQueryDto): Observable<AuditLogPage> {
    const params: Record<string, string> = {};
    if (query.action) params['action'] = query.action;
    if (query.entity) params['entity'] = query.entity;
    if (query.entityId) params['entityId'] = query.entityId;
    if (query.fromISO) params['fromISO'] = query.fromISO;
    if (query.toISO) params['toISO'] = query.toISO;
    if (query.skip !== undefined) params['skip'] = String(query.skip);
    if (query.take !== undefined) params['take'] = String(query.take);
    return this.http.get<AuditLogPage>(this.base, { params });
  }
}
