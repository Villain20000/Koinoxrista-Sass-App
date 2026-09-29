import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  AnnouncementCommentDto,
  AnnouncementDto,
  CommentDto,
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from '@org/shared';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AnnouncementsApiService {
  private readonly http = inject(HttpClient);
  private readonly buildingsBase = `${environment.apiUrl}/buildings`;
  private readonly announcementsBase = `${environment.apiUrl}/announcements`;

  /** Admin list: every announcement of the building, pinned first. */
  listAdmin(buildingId: string): Observable<AnnouncementDto[]> {
    return this.http.get<AnnouncementDto[]>(
      `${this.buildingsBase}/${buildingId}/announcements`,
    );
  }

  /** Resident/admin newsfeed, pinned first then newest. */
  feed(buildingId: string): Observable<AnnouncementDto[]> {
    return this.http.get<AnnouncementDto[]>(
      `${this.buildingsBase}/${buildingId}/feed`,
    );
  }

  create(
    buildingId: string,
    dto: CreateAnnouncementDto,
  ): Observable<AnnouncementDto> {
    return this.http.post<AnnouncementDto>(
      `${this.buildingsBase}/${buildingId}/announcements`,
      dto,
    );
  }

  update(id: string, dto: UpdateAnnouncementDto): Observable<AnnouncementDto> {
    return this.http.patch<AnnouncementDto>(
      `${this.announcementsBase}/${id}`,
      dto,
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.announcementsBase}/${id}`);
  }

  comments(announcementId: string): Observable<AnnouncementCommentDto[]> {
    return this.http.get<AnnouncementCommentDto[]>(
      `${this.announcementsBase}/${announcementId}/comments`,
    );
  }

  addComment(
    announcementId: string,
    dto: CommentDto,
  ): Observable<AnnouncementCommentDto> {
    return this.http.post<AnnouncementCommentDto>(
      `${this.announcementsBase}/${announcementId}/comments`,
      dto,
    );
  }

  deleteComment(announcementId: string, commentId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.announcementsBase}/${announcementId}/comments/${commentId}`,
    );
  }
}
