import { Inject, Injectable } from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  Mailer,
  MAILER,
} from './mailer';
import {
  buildReminderHtml,
  buildReminderSubject,
  ReminderLineItem,
} from './reminder-emails';

interface ReminderTarget {
  email: string;
  items: ReminderLineItem[];
}

@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly notifications: NotificationsService,
  ) {}

  /** Units with outstanding invoices (optionally restricted to one period), grouped per recipient email. */
  async findTargets(
    buildingId: string,
    periodYearMonth?: string,
  ): Promise<ReminderTarget[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        buildingId,
        ...(periodYearMonth ? { periodYearMonth } : {}),
      },
      orderBy: { periodYearMonth: 'asc' },
    });

    const outstandingByUnitId = new Map<string, ReminderLineItem[]>();
    for (const invoice of invoices) {
      const outstandingCents = invoice.totalCents - invoice.paidCents;
      if (outstandingCents <= 0) continue;
      const items = outstandingByUnitId.get(invoice.unitId) ?? [];
      items.push({ unitLabel: '', periodYearMonth: invoice.periodYearMonth, outstandingCents });
      outstandingByUnitId.set(invoice.unitId, items);
    }
    if (outstandingByUnitId.size === 0) return [];

    const [units, ownerships] = await Promise.all([
      this.prisma.unit.findMany({ where: { buildingId } }),
      this.prisma.ownership.findMany({
        where: { unit: { buildingId } },
        select: { unitId: true, user: { select: { email: true } } },
      }),
    ]);
    const labelByUnitId = new Map(units.map((unit) => [unit.id, unit.label]));

    const itemsByEmail = new Map<string, ReminderLineItem[]>();
    for (const ownership of ownerships) {
      const items = outstandingByUnitId.get(ownership.unitId);
      if (!items) continue;
      const email = ownership.user.email.toLowerCase();
      const merged = itemsByEmail.get(email) ?? [];
      for (const item of items) {
        merged.push({ ...item, unitLabel: labelByUnitId.get(ownership.unitId) ?? '' });
      }
      itemsByEmail.set(email, merged);
    }

    return [...itemsByEmail.entries()]
      .map(([email, items]) => ({ email, items }))
      .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  }

  async preview(
    buildingId: string,
    periodYearMonth: string | undefined,
    user: AuthenticatedUser,
  ): Promise<{ recipients: string[]; subject: string }> {
    assertSameBuilding(user, buildingId);
    const targets = await this.findTargets(buildingId, periodYearMonth);
    return {
      recipients: targets.map((target) => target.email),
      subject: buildReminderSubject(periodYearMonth),
    };
  }

  async send(
    buildingId: string,
    periodYearMonth: string | undefined,
    user: AuthenticatedUser,
  ): Promise<{ sent: number }> {
    assertSameBuilding(user, buildingId);
    const targets = await this.findTargets(buildingId, periodYearMonth);
    if (targets.length === 0) {
      return { sent: 0 };
    }

    const balanceUrl = `${process.env.APP_BASE_URL ?? 'http://localhost:4200'}/balance`;
    const subject = buildReminderSubject(periodYearMonth);
    await Promise.all(
      targets.map((target) =>
        this.mailer.send(target.email, subject, buildReminderHtml(target.items, balanceUrl)),
      ),
    );
    await this.notifyBySms(buildingId, periodYearMonth);
    return { sent: targets.length };
  }

  /** Concise Greek SMS to owners with a phone on file; dedupe + failures handled by NotificationsService. */
  private async notifyBySms(
    buildingId: string,
    periodYearMonth?: string,
  ): Promise<void> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        buildingId,
        ...(periodYearMonth ? { periodYearMonth } : {}),
      },
      select: { unitId: true, totalCents: true, paidCents: true },
    });
    const outstandingUnitIds = [
      ...new Set(
        invoices
          .filter((invoice) => invoice.totalCents - invoice.paidCents > 0)
          .map((invoice) => invoice.unitId),
      ),
    ];
    if (outstandingUnitIds.length === 0) return;

    const owners = await this.prisma.ownership.findMany({
      where: { unitId: { in: outstandingUnitIds } },
      select: { userId: true, user: { select: { phone: true } } },
      distinct: ['userId'],
    });
    const uniqueOwners = [
      ...new Map(owners.map((owner) => [owner.userId, owner])).values(),
    ];
    await this.notifications.sendSmsToUsers(
      uniqueOwners.map((owner) => ({
        userId: owner.userId,
        phone: owner.user.phone,
      })),
      {
        kind: 'arrears.reminder',
        ...(periodYearMonth ? { periodKey: periodYearMonth } : {}),
      },
    );
  }
}
