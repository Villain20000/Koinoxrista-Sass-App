import { Logger } from '@nestjs/common';
import * as webpush from 'web-push';

/** Mirrors libs/shared/src/lib/notifications.ts `PushPayload` (types only). */
export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  send(sub: PushSubscriptionKeys, payload: PushPayload): Promise<void>;
}

export const PUSH_SENDER = Symbol('PUSH_SENDER');

export class WebPushSender implements PushSender {
  constructor(
    private readonly vapid: {
      subject: string;
      publicKey: string;
      privateKey: string;
    },
  ) {}

  async send(sub: PushSubscriptionKeys, payload: PushPayload): Promise<void> {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { vapidDetails: this.vapid },
    );
  }
}

export class ConsolePushSender implements PushSender {
  private readonly logger = new Logger(ConsolePushSender.name);

  async send(sub: PushSubscriptionKeys, payload: PushPayload): Promise<void> {
    this.logger.log(
      `Push → ${sub.endpoint} | ${payload.title}\n${payload.body ?? ''}`,
    );
  }
}

/** Web Push when VAPID keys are configured, otherwise log to console. */
export function createPushSender(): PushSender {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    return new WebPushSender({
      subject:
        process.env.VAPID_SUBJECT ?? 'mailto:support@koinoxrista-os.gr',
      publicKey,
      privateKey,
    });
  }
  return new ConsolePushSender();
}
