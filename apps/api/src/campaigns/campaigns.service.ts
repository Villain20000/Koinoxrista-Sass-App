import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer, MAILER } from '../reminders/mailer';
import { escapeHtml } from '../reminders/reminder-emails';

export type CampaignAudience = 'ALL' | 'RESIDENTS' | 'ARREARS';
export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT';

export interface CampaignView {
  id: string;
  buildingId: string;
  subject: string;
  body: string;
  audience: CampaignAudience;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  sentCount: number;
  failCount: number;
  trackOpens: boolean;
  createdAt: string;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  list(buildingId: string, user: AuthenticatedUser): Promise<CampaignView[]> {
    assertSameBuilding(user, buildingId);
    return this.prisma.campaign
      .findMany({ where: { buildingId }, orderBy: { createdAt: 'desc' } })
      .then((rows) => rows.map((row) => this.toView(row)));
  }

  async create(
    buildingId: string,
    dto: {
      subject: string;
      body: string;
      audience: CampaignAudience;
      scheduledAt?: string;
      trackOpens?: boolean;
    },
    user: AuthenticatedUser,
  ): Promise<CampaignView> {
    assertSameBuilding(user, buildingId);
    if (!this.isAdminLike(user)) {
      throw new ForbiddenException('Only admins can create campaigns');
    }
    const campaign = await this.prisma.campaign.create({
      data: {
        buildingId,
        subject: dto.subject,
        body: dto.body,
        audience: dto.audience,
        status: dto.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        trackOpens: dto.trackOpens ?? true,
        createdById: user.id,
      },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'campaign.create',
      entity: 'campaign',
      entityId: campaign.id,
      metadata: { subject: campaign.subject, audience: campaign.audience },
    });
    return this.toView(campaign);
  }

  /** Send a DRAFT/SCHEDULED campaign immediately (idempotent: SENT → 409). */
  async send(campaignId: string, user: AuthenticatedUser): Promise<CampaignView> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { building: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    assertSameBuilding(user, campaign.buildingId);
    if (!this.isAdminLike(user)) {
      throw new ForbiddenException('Only admins can send campaigns');
    }
    if (campaign.status === 'SENT' || campaign.status === 'SENDING') {
      throw new ConflictException('Campaign has already been sent');
    }

    const recipients = await this.resolveRecipients(
      campaign.buildingId,
      campaign.audience as CampaignAudience,
    );
    await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'SENDING' },
    });

    let sent = 0;
    let failed = 0;
    const appUrl = process.env.APP_BASE_URL ?? process.env.APP_URL ?? 'http://localhost:4200';
    const allRecipients = recipientShapes(recipients);
    for (const recipient of allRecipients) {
      try {
        const trackPixel =
          campaign.trackOpens && recipient.id
            ? `<img src="${appUrl}/api/campaigns/${campaign.id}/open.gif?uid=${encodeURIComponent(recipient.id)}" width="1" height="1" alt="" />`
            : '';
        await this.mailer.send(
          recipient.email,
          applyTemplate(campaign.subject, recipient.context),
          applyTemplate(campaign.body, recipient.context) + trackPixel,
        );
        await this.prisma.campaignRecipient.upsert({
          where: { campaignId_userId: { campaignId: campaign.id, userId: recipient.id } },
          update: { status: 'SENT', sentAt: new Date(), error: null },
          create: {
            campaignId: campaign.id,
            userId: recipient.id,
            email: recipient.email,
            status: 'SENT',
            sentAt: new Date(),
          },
        });
        sent++;
      } catch (error) {
        failed++;
        await this.prisma.campaignRecipient.upsert({
          where: { campaignId_userId: { campaignId: campaign.id, userId: recipient.id } },
          update: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
          create: {
            campaignId: campaign.id,
            userId: recipient.id,
            email: recipient.email,
            status: 'FAILED',
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'SENT', sentAt: new Date(), sentCount: sent, failCount: failed },
    });
    this.audit.record({
      buildingId: campaign.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'campaign.send',
      entity: 'campaign',
      entityId: campaign.id,
      metadata: { sent, failed },
    });
    return this.toView(updated);
  }

  /** 1×1 transparent GIF; records a single open per recipient. */
  async recordOpen(campaignId: string, uid: string): Promise<void> {
    const recipient = await this.prisma.campaignRecipient.findFirst({
      where: { campaignId, userId: uid, status: 'SENT', openedAt: null },
    });
    if (!recipient) return;
    await this.prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: 'OPENED', openedAt: new Date() },
    });
  }

  async stats(campaignId: string, user: AuthenticatedUser) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        recipients: {
          select: { id: true, email: true, status: true, sentAt: true, openedAt: true },
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    assertSameBuilding(user, campaign.buildingId);
    const opened = campaign.recipients.filter((r) => r.status === 'OPENED').length;
    return {
      id: campaign.id,
      status: campaign.status,
      sentCount: campaign.sentCount,
      failCount: campaign.failCount,
      openedCount: opened,
      recipients: campaign.recipients,
    };
  }

  async preview(buildingId: string, user: AuthenticatedUser): Promise<{ subject: string; body: string }> {
    assertSameBuilding(user, buildingId);
    return {
      subject: 'Καλώς ήρθατε, {{firstName}}!',
      body: 'Αγαπητέ {{firstName}}, μάθετε τα τελευταία νέα του διαμερίσματος {{unitLabel}}.',
    };
  }

  private async resolveRecipients(
    buildingId: string,
    audience: CampaignAudience,
  ): Promise<{ user: { id: string; email: string; firstName: string } }[]> {
    const users = await this.prisma.user.findMany({
      where: {
        buildingId,
        role: { in: [Role.RESIDENT, Role.ADMIN, Role.BUILDING_OWNER] },
      },
      select: { id: true, email: true, firstName: true },
    });
    if (audience === 'ALL') return users.map((u) => ({ user: u }));

    const ownerships = await this.prisma.ownership.findMany({
      where: { unit: { buildingId } },
      select: { userId: true, unitId: true, unit: { select: { label: true } } },
      distinct: ['userId'],
    });
    const ownerIds = new Set(ownerships.map((o) => o.userId));
    if (audience === 'RESIDENTS') {
      return users.filter((u) => ownerIds.has(u.id)).map((u) => ({ user: u }));
    }

    // ARREARS: outstanding invoices.
    const invoices = await this.prisma.invoice.findMany({
      where: { buildingId },
      select: { unitId: true, totalCents: true, paidCents: true },
    });
    const arrearsUnitIds = new Set(
      invoices
        .filter((inv) => inv.totalCents - inv.paidCents > 0)
        .map((inv) => inv.unitId),
    );
    const arrearsOwners = ownerships.filter((o) => arrearsUnitIds.has(o.unitId));
    const arrearsOwnerIds = new Set(arrearsOwners.map((o) => o.userId));
    return users.filter((u) => arrearsOwnerIds.has(u.id)).map((u) => ({ user: u }));
  }

  private isAdminLike(user: AuthenticatedUser): boolean {
    return user.role === Role.ADMIN || user.role === Role.BUILDING_OWNER;
  }

  private toView(row: {
    id: string;
    buildingId: string;
    subject: string;
    body: string;
    audience: string;
    status: string;
    scheduledAt: Date | null;
    sentAt: Date | null;
    sentCount: number;
    failCount: number;
    trackOpens: boolean;
    createdAt: Date;
  }): CampaignView {
    return {
      id: row.id,
      buildingId: row.buildingId,
      subject: row.subject,
      body: row.body,
      audience: row.audience as CampaignAudience,
      status: row.status as CampaignStatus,
      scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      sentCount: row.sentCount,
      failCount: row.failCount,
      trackOpens: row.trackOpens,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

interface RecipientShape {
  id: string;
  email: string;
  context: { firstName: string; unitLabel: string };
}

function recipientShapes(
  rows: { user: { id: string; email: string; firstName: string } }[],
): RecipientShape[] {
  return rows.map(({ user }) => ({
    id: user.id,
    email: user.email,
    context: { firstName: user.firstName, unitLabel: '' },
  }));
}

/** Merge-tag substitution for {{firstName}} / {{unitLabel}}. */
function applyTemplate(template: string, context: { firstName: string; unitLabel: string }): string {
  return template
    .replace(/\{\{firstName\}\}/g, escapeHtml(context.firstName))
    .replace(/\{\{unitLabel\}\}/g, escapeHtml(context.unitLabel));
}