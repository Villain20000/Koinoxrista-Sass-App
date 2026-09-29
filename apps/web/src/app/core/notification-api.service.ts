import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsListDto {
  items: NotificationDto[];
  totalUnread: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/notifications`;

  list(options?: {
    unread?: boolean;
    skip?: number;
    take?: number;
  }): Observable<NotificationsListDto> {
    const params: Record<string, string> = {};
    if (options?.unread) params["unread"] = '1';
    if (options?.skip != null) params["skip"] = String(options.skip);
    if (options?.take != null) params["take"] = String(options.take);
    return this.http.get<NotificationsListDto>(this.base, { params });
  }

  markRead(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/read`, {});
  }

  markAllRead(): Observable<void> {
    return this.http.post<void>(`${this.base}/read-all`, {});
  }
}
