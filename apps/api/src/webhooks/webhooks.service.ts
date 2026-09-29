import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { Cron } from '@nestjs/schedule';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';

export interface WebhookEndpointView {
  id: string;
  buildingId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

/** HMAC-SHA256 signature header: `t=<ts>,v1=<hex>`. */
export function signWebhookPayload(secret: string, payload: string, ts: number): string {
  const signature = createHmac('sha256', secret)
    .update(`${ts}.${payload}`)
    .digest('hex');
  return `t=${ts},v1=${signature}`;
}

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 25 * 60_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly ENABLED = process.env.WEBHOOKS_ENABLED !== 'false';

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(buildingId: string, user: AuthenticatedUser): Promise<WebhookEndpointView[]> {
    assertSameBuilding(user, buildingId);
    return this.prisma.webhookEndpoint
      .findMany({ where: { buildingId }, orderBy: { createdAt: 'asc' } })
      .then((rows) => rows.map((row) => this.toView(row)));
  }

  async create(
    buildingId: string,
    dto: { url: string; events: string[]; active?: boolean },
    user: AuthenticatedUser,
  ): Promise<WebhookEndpointView & { secret: string }> {
    assertSameBuilding(user, buildingId);
    const secret = randomBytes(24).toString('hex');
    const created = await this.prisma.webhookEndpoint.create({
      data: {
        buildingId,
        url: dto.url,
        secret,
        events: dto.events,
        active: dto.active ?? true,
      },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'webhook.create',
      entity: 'webhook_endpoint',
      entityId: created.id,
      metadata: { url: created.url, events: created.events },
    });
    // The raw secret is shown once at creation.
    return { ...this.toView(created), secret };
  }

  async remove(buildingId: string, id: string, user: AuthenticatedUser): Promise<void> {
    assertSameBuilding(user, buildingId);
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id, buildingId },
    });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'webhook.delete',
      entity: 'webhook_endpoint',
      entityId: id,
    });
  }

  async deliveries(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { buildingId },
      select: { id: true, url: true },
    });
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: { in: endpoints.map((e) => e.id) } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Fire `event` to every active endpoint subscribed to it. Creates delivery
   * rows and attempts immediately (first attempt), scheduling retries.
   */
  async dispatch(buildingId: string, event: string, payload: unknown): Promise<void> {
    if (!this.ENABLED) return;
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { buildingId, active: true, events: { has: event } },
    });
    if (endpoints.length === 0) return;

    const body = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);

    for (const endpoint of endpoints) {
      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          event,
          payload: payload as never,
          status: 'PENDING',
          nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MS[0]),
        },
      });
      await this.attempt(endpoint.id, delivery.id, endpoint.url, endpoint.secret, body, ts);
    }
  }

  /** Periodic retry of failed PENDING/FAILED deliveries under max attempts. */
  @Cron('*/5 * * * *')
  async retryLoop(): Promise<void> {
    if (!this.ENABLED) return;
    const due = await this.prisma.webhookDelivery.findMany({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: MAX_ATTEMPTS },
        nextRetryAt: { lte: new Date() },
      },
      take: 100,
    });
    for (const delivery of due) {
      const endpoint = await this.prisma.webhookEndpoint.findUnique({
        where: { id: delivery.endpointId },
      });
      if (!endpoint) continue;
      const body = JSON.stringify(delivery.payload);
      const ts = Math.floor(Date.now() / 1000);
      await this.attempt(
        endpoint.id,
        delivery.id,
        endpoint.url,
        endpoint.secret,
        body,
        ts,
        true,
      );
    }
  }

  private async attempt(
    endpointId: string,
    deliveryId: string,
    url: string,
    secret: string,
    body: string,
    ts: number,
    isRetry = false,
  ): Promise<void> {
    const signature = signWebhookPayload(secret, body, ts);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Polyk-Signature': signature,
        },
        body,
      });
      if (res.ok) {
        await this.prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: { status: 'SUCCESS', attempts: { increment: 1 }, lastStatus: res.status, nextRetryAt: null },
        });
      } else {
        const nextAttempt = (await this.currentAttempt(deliveryId)) + 1;
        await this.prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: nextAttempt >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
            attempts: { increment: 1 },
            lastStatus: res.status,
            response: `HTTP ${res.status}`,
            nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MS[nextAttempt - 1]),
          },
        });
      }
    } catch (error) {
      const nextAttempt = (await this.currentAttempt(deliveryId)) + 1;
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: nextAttempt >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          attempts: { increment: 1 },
          response: error instanceof Error ? error.message : String(error),
          nextRetryAt: new Date(Date.now() + RETRY_DELAYS_MS[nextAttempt - 1]),
        },
      });
      this.logger.warn(
        `webhook delivery ${deliveryId} failed (${isRetry ? 'retry' : 'first'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async currentAttempt(deliveryId: string): Promise<number> {
    const row = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: { attempts: true },
    });
    return row?.attempts ?? 0;
  }

  private toView(row: {
    id: string;
    buildingId: string;
    url: string;
    events: string[];
    active: boolean;
    createdAt: Date;
  }): WebhookEndpointView {
    return {
      id: row.id,
      buildingId: row.buildingId,
      url: row.url,
      events: row.events,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    };
  }
}