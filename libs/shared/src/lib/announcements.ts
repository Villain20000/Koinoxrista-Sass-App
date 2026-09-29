/** Audience of a building announcement. */
export type AnnouncementAudience = 'ALL' | 'RESIDENTS';

/**
 * A building announcement (newsfeed post). `pinned` items surface first
 * inside their day group; dates are ISO strings.
 */
export interface AnnouncementDto {
  id: string;
  buildingId: string;
  authorId: string;
  /** Display name of the admin author (fall back to email server-side). */
  authorName: string;
  title: string;
  body: string;
  pinned: boolean;
  audience: AnnouncementAudience;
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementDto {
  title: string;
  body: string;
  pinned?: boolean;
  audience?: AnnouncementAudience;
}

export interface UpdateAnnouncementDto {
  title?: string;
  body?: string;
  pinned?: boolean;
  audience?: AnnouncementAudience;
}

/** A Q&A comment/reply posted by a resident or an admin on an announcement. */
export interface AnnouncementCommentDto {
  id: string;
  announcementId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

/** Body of `POST /announcements/:id/comments`. */
export interface CommentDto {
  /** Free text; at most 1000 characters (enforced client- and server-side). */
  body: string;
}
