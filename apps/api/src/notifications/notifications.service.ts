import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  PUSH_SENDER,
  PushPayload,
  PushSender,
} from './push-sender';
import { SMS_SENDER, SmsSender } from './sms-sender';
import {
  buildNotificationSms,
  SmsContext,
} from './sms-templates';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  linkPath?: string;
  /** Opt-in SMS dispatch for kinds with a template (see sms-templates.ts). */
  sms?: SmsContext;
}

export interface SmsRecipient {
  userId: string;
  phone: string | null;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  skip?: number;
  take?: number;
}

const MAX_PAGE_SIZE = 50;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** (kind,userId,periodKey) already sent during this run — in-memory dedupe. */
  private readonly sentSmsKeys = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_SENDER) private readonly pushSender: PushSender,
    @Inject(SMS_SENDER) private readonly smsSender: SmsSender,
    private readonly realtime: RealtimeService,
  ) {}

  /** Persists one notification and fire-and-forget pushes it; never throws. */
  async create(input: CreateNotificationInput): Promise<void> {
    try {
      await this.prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          linkPath: input.linkPath ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`notification create failed: ${String(err)}`);
      return;
    }
    this.realtime.publishToUser(input.userId, 'notification.created', {
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      linkPath: input.linkPath ?? null,
    });
    await this.pushToUser(input.userId, {
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.linkPath !== undefined ? { url: input.linkPath } : {}),
    });
    if (input.sms) {
      await this.dispatchSms(input.userId, input.sms);
    }
  }

  /** Batch-persists one row per user (createMany), then pushes per user. */
  async createForUsers(
    userIds: string[],
    data: Omit<CreateNotificationInput, 'userId'>,
  ): Promise<void> {
    const distinct = [...new Set(userIds)];
    if (distinct.length === 0) return;

    try {
      await this.prisma.notification.createMany({
        data: distinct.map((userId) => ({
          userId,
          type: data.type,
          title: data.title,
          body: data.body ?? null,
          linkPath: data.linkPath ?? null,
        })),
      });
    } catch (err) {
      this.logger.error(`notification createMany failed: ${String(err)}`);
      return;
    }
    const realtimePayload = {
      type: data.type,
      title: data.title,
      body: data.body ?? null,
      linkPath: data.linkPath ?? null,
    };
    for (const userId of distinct) {
      this.realtime.publishToUser(userId, 'notification.created', realtimePayload);
    }
    await Promise.all(
      distinct.map((userId) =>
        this.pushToUser(userId, {
          title: data.title,
          ...(data.body !== undefined ? { body: data.body } : {}),
          ...(data.linkPath !== undefined ? { url: data.linkPath } : {}),
        }),
      ),
    );
    const sms = data.sms;
    if (sms) {
      await Promise.all(distinct.map((userId) => this.dispatchSms(userId, sms)));
    }
  }

  async listForUser(
    userId: string,
    options: ListNotificationsOptions = {},
  ): Promise<{ items: unknown[]; totalUnread: number }> {
    const take = Math.min(Math.max(options.take ?? 20, 1), MAX_PAGE_SIZE);
    const where = {
      userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
    };

    const [items, totalUnread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: options.skip ?? 0,
        take,
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return { items, totalUnread };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async upsertSubscription(
    userId: string,
    sub: { endpoint: string; p256dh: string; auth: string },
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: { userId, p256dh: sub.p256dh, auth: sub.auth },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    });
  }

  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint, userId },
    });
  }

  /**
   * Sends one SMS per recipient that has a phone on file, with run-scoped
   * dedupe; used by flows that notify without persisting (e.g. arrears
   * reminder emails). Never throws.
   */
  async sendSmsToUsers(
    recipients: SmsRecipient[],
    sms: SmsContext,
  ): Promise<void> {
    const text = buildNotificationSms(sms.kind, sms);
    if (!text) return;
    await Promise.all(
      recipients
        .filter((recipient) => Boolean(recipient.phone))
        .map((recipient) =>
          this.deliverSms(recipient.userId, recipient.phone as string, text, sms),
        ),
    );
  }

  /** SMS mirrors push: failures are swallowed so host flows never break. */
  private async dispatchSms(userId: string, sms: SmsContext): Promise<void> {
    const text = buildNotificationSms(sms.kind, sms);
    if (!text) return;

    let phone: string | null;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true },
      });
      phone = user?.phone ?? null;
    } catch (err) {
      this.logger.error(`sms phone lookup failed: ${String(err)}`);
      return;
    }
    if (!phone) return;

    await this.deliverSms(userId, phone, text, sms);
  }

  private async deliverSms(
    userId: string,
    phone: string,
    text: string,
    sms: SmsContext,
  ): Promise<void> {
    const key = `${sms.kind}|${userId}|${sms.periodKey ?? ''}`;
    if (this.sentSmsKeys.has(key)) return;
    this.sentSmsKeys.add(key);

    try {
      const result = await this.smsSender.send(phone, text);
      if (!result.ok) {
        this.logger.warn(`sms to ${userId} failed: ${result.error ?? 'unknown error'}`);
      }
    } catch (err) {
      this.logger.warn(`sms to ${userId} failed: ${String(err)}`);
    }
  }

  /** Push failures are swallowed; gone endpoints (404/410) are removed. */
  private async pushToUser(userId: string, payload: PushPayload): Promise<void> {
    let subs: { endpoint: string; p256dh: string; auth: string }[];
    try {
      subs = await this.prisma.pushSubscription.findMany({
        where: { userId },
      });
    } catch (err) {
      this.logger.error(`push subscription lookup failed: ${String(err)}`);
      return;
    }

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await this.pushSender.send(sub, payload);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            try {
              await this.prisma.pushSubscription.deleteMany({
                where: { endpoint: sub.endpoint },
              });
            } catch (deleteErr) {
              this.logger.error(
                `push subscription cleanup failed: ${String(deleteErr)}`,
              );
            }
            return;
          }
          this.logger.warn(
            `push to ${sub.endpoint} failed: ${String(err)}`,
          );
        }
      }),
    );
  }
}
