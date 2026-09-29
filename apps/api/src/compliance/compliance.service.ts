import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ComplianceKind, Role, type ComplianceItem } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComplianceDto } from './dto/create-compliance.dto';
import { UpdateComplianceDto } from './dto/update-compliance.dto';

const MS_PER_DAY = 86_400_000;
/** Items expiring within this horizon are reported by checkExpiries. */
const CHECK_WINDOW_DAYS = 30;
/** An unread notification suppresses re-notifying the same item for a week. */
const DEDUPE_WINDOW_DAYS = 7;

export const COMPLIANCE_EXPIRING_TYPE = 'compliance.expiring';
export const COMPLIANCE_LINK_PATH = '/admin/compliance';

const KIND_VALUES: string[] = Object.values(ComplianceKind);

/** Whole calendar days (UTC) from `now` until `endsOn`; negative when past. */
export function daysLeftOf(endsOn: Date, now: Date): number {
  const utcDay = (date: Date) =>
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((utcDay(endsOn) - utcDay(now)) / MS_PER_DAY);
}

function dayPhrase(days: number): string {
  if (days === 0) return 'λήγει σήμερα';
  if (days === 1) return 'λήξη σε 1 ημέρα';
  return `λήξη σε ${days} ημέρες`;
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    buildingId: string,
    user: AuthenticatedUser,
    query: { kind?: string; upcomingDays?: string } = {},
  ): Promise<ReturnType<ComplianceService['toDto']>[]> {
    assertSameBuilding(user, buildingId);
    const kind = this.parseKind(query.kind);
    const upcomingDays = this.parseUpcomingDays(query.upcomingDays);

    const now = new Date();
    const items = await this.prisma.complianceItem.findMany({
      where: {
        buildingId,
        ...(kind ? { kind } : {}),
        // No lower bound: still-future items within N days AND already
        // expired ones are both part of the "upcoming" picture.
        ...(upcomingDays !== undefined
          ? { endsOn: { lte: new Date(now.getTime() + upcomingDays * MS_PER_DAY) } }
          : {}),
      },
      orderBy: { endsOn: 'asc' },
    });
    return items.map((item) => this.toDto(item, now));
  }

  async create(
    buildingId: string,
    dto: CreateComplianceDto,
    user: AuthenticatedUser,
  ): Promise<ReturnType<ComplianceService['toDto']>> {
    assertSameBuilding(user, buildingId);
    this.assertDateOrder(dto.startsOn, dto.endsOn);

    const created = await this.prisma.complianceItem.create({
      data: {
        buildingId,
        kind: dto.kind,
        title: dto.title,
        ...(dto.providerName !== undefined
          ? { providerName: dto.providerName }
          : {}),
        ...(dto.policyNumber !== undefined
          ? { policyNumber: dto.policyNumber }
          : {}),
        ...(dto.premiumCents !== undefined
          ? { premiumCents: dto.premiumCents }
          : {}),
        startsOn: new Date(dto.startsOn),
        endsOn: new Date(dto.endsOn),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'compliance.created',
      entity: 'compliance_item',
      entityId: created.id,
      metadata: { kind: created.kind, title: created.title },
    });
    return this.toDto(created, new Date());
  }

  async update(
    id: string,
    dto: UpdateComplianceDto,
    user: AuthenticatedUser,
  ): Promise<ReturnType<ComplianceService['toDto']>> {
    const item = await this.findOwned(user, id);

    const startsOn = dto.startsOn ?? item.startsOn.toISOString();
    const endsOn = dto.endsOn ?? item.endsOn.toISOString();
    this.assertDateOrder(startsOn, endsOn);

    const updated = await this.prisma.complianceItem.update({
      where: { id: item.id },
      data: {
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.providerName !== undefined
          ? { providerName: dto.providerName }
          : {}),
        ...(dto.policyNumber !== undefined
          ? { policyNumber: dto.policyNumber }
          : {}),
        ...(dto.premiumCents !== undefined
          ? { premiumCents: dto.premiumCents }
          : {}),
        ...(dto.startsOn !== undefined ? { startsOn: new Date(startsOn) } : {}),
        ...(dto.endsOn !== undefined ? { endsOn: new Date(endsOn) } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    this.audit.record({
      buildingId: updated.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'compliance.updated',
      entity: 'compliance_item',
      entityId: updated.id,
      metadata: { title: updated.title },
    });
    return this.toDto(updated, new Date());
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const item = await this.findOwned(user, id);
    await this.prisma.complianceItem.delete({ where: { id: item.id } });
    this.audit.record({
      buildingId: item.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'compliance.deleted',
      entity: 'compliance_item',
      entityId: item.id,
      metadata: { title: item.title },
    });
  }

  /**
   * Reports items whose endsOn falls within the next 30 days by creating one
   * notification per ADMIN of the building. Dedupe: a (userId, itemId) pair is
   * skipped when an unread notification of the same type whose body contains
   * the item title was created within the last 7 days.
   */
  async checkExpiries(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<{ notified: number; skipped: number }> {
    assertSameBuilding(user, buildingId);

    const now = new Date();
    const items = await this.prisma.complianceItem.findMany({
      where: {
        buildingId,
        endsOn: {
          gte: now,
          lte: new Date(now.getTime() + CHECK_WINDOW_DAYS * MS_PER_DAY),
        },
      },
      orderBy: { endsOn: 'asc' },
    });
    if (items.length === 0) {
      return { notified: 0, skipped: 0 };
    }
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN, buildingId },
      select: { id: true },
    });
    if (admins.length === 0) {
      return { notified: 0, skipped: 0 };
    }

    const recent = await this.prisma.notification.findMany({
      where: {
        userId: { in: admins.map((admin) => admin.id) },
        type: COMPLIANCE_EXPIRING_TYPE,
        readAt: null,
        createdAt: {
          gte: new Date(now.getTime() - DEDUPE_WINDOW_DAYS * MS_PER_DAY),
        },
        body: { not: null },
      },
      select: { userId: true, body: true },
    });

    let notified = 0;
    let skipped = 0;
    for (const item of items) {
      for (const admin of admins) {
        const alreadyNotified = recent.some(
          (entry) =>
            entry.userId === admin.id &&
            (entry.body ?? '').includes(item.title),
        );
        if (alreadyNotified) {
          skipped += 1;
          continue;
        }
        await this.notifications.create({
          userId: admin.id,
          type: COMPLIANCE_EXPIRING_TYPE,
          title: `${item.title}: ${dayPhrase(daysLeftOf(item.endsOn, now))}`,
          body: `${item.title} — ${dayPhrase(daysLeftOf(item.endsOn, now))}`,
          linkPath: COMPLIANCE_LINK_PATH,
        });
        notified += 1;
      }
    }

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'compliance.expiry_check',
      entity: 'compliance_item',
      entityId: null,
      metadata: { items: items.length, notified, skipped },
    });
    return { notified, skipped };
  }

  private toDto(item: ComplianceItem, now: Date) {
    const daysLeft = daysLeftOf(item.endsOn, now);
    return {
      id: item.id,
      buildingId: item.buildingId,
      kind: item.kind,
      title: item.title,
      providerName: item.providerName,
      policyNumber: item.policyNumber,
      premiumCents: item.premiumCents,
      startsOn: item.startsOn.toISOString(),
      endsOn: item.endsOn.toISOString(),
      notes: item.notes,
      expired: daysLeft < 0,
      daysLeft,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private parseKind(kind: string | undefined): ComplianceKind | undefined {
    if (kind === undefined || kind === '') return undefined;
    if (!KIND_VALUES.includes(kind)) {
      throw new BadRequestException('Invalid compliance kind');
    }
    return kind as ComplianceKind;
  }

  private parseUpcomingDays(raw: string | undefined): number | undefined {
    if (raw === undefined || raw === '') return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException('upcomingDays must be a non-negative integer');
    }
    return value;
  }

  private assertDateOrder(startsOn: string, endsOn: string): void {
    if (new Date(endsOn).getTime() <= new Date(startsOn).getTime()) {
      throw new BadRequestException('endsOn must be after startsOn');
    }
  }

  private findOwned(user: AuthenticatedUser, id: string) {
    if (!user.buildingId) {
      throw new ForbiddenException('User is not attached to a building');
    }
    return this.prisma.complianceItem
      .findFirst({ where: { id, buildingId: user.buildingId } })
      .then((item) => {
        if (!item) {
          throw new NotFoundException('Compliance item not found');
        }
        return item;
      });
  }
}
