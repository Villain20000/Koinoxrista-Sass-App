/** Notification types emitted by the backend (Phase 7). */
export const NOTIFICATION_TYPES = [
  'invoice.issued',
  'vote.opened',
  'vote.closed',
  'bid.received',
  'bid.accepted',
  'worklog.added',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Payload delivered to service workers via the Web Push protocol.
 * `url` is an in-app deep link (e.g. '/balance') the client opens on click.
 */
export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
}

/** In-app notification inbox entry; `readAt` null = unread. Dates are ISO strings. */
export interface NotificationDto {
  id: string;
  userId: string;
  type: NotificationType | string;
  title: string;
  body?: string | null;
  linkPath?: string | null;
  readAt: string | null;
  createdAt: string;
}

/** GET /notifications response page. */
export interface NotificationListDto {
  items: NotificationDto[];
  totalUnread: number;
}

/**
 * POST /push/subscriptions body — the PushSubscriptionJSON captured from
 * `pushManager.subscribe()` on the client:
 * { endpoint: string; p256dh: string; auth: string }
 * DELETE /push/subscriptions takes only { endpoint }.
 */
export interface SubscribePushDto {
  endpoint: string;
  p256dh: string;
  auth: string;
}
