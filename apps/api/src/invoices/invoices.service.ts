import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { TOTAL_MILLIMES } from '@org/shared';
import {
  assertSameBuilding,
  requireValidPeriod,
} from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { aggregateRun } from './run-invoices';
import { RunInvoicesDto } from './dto/run-invoices.dto';

const INVOICE_WITH_UNIT = Prisma.validator<Prisma.InvoiceInclude>()({
  unit: { select: { label: true } },
});

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(
    buildingId: string,
    dto: RunInvoicesDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const periodYearMonth = requireValidPeriod(dto.periodYearMonth);

    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      include: { units: { orderBy: { label: 'asc' } } },
    });
    if (!building) {
      throw new BadRequestException('Building not found');
    }

    const millimesTotal = building.units.reduce(
      (sum, unit) => sum + unit.millimes,
      0,
    );
    if (millimesTotal !== TOTAL_MILLIMES) {
      throw new BadRequestException(
        `millimes must total ${TOTAL_MILLIMES} but units sum to ${millimesTotal}`,
      );
    }

    const expenses = await this.prisma.expense.findMany({
      where: { buildingId, periodYearMonth },
      include: { shares: { select: { unitId: true, amountCents: true } } },
    });
    if (expenses.length === 0) {
      throw new BadRequestException('no expenses for period');
    }

    const totals = new Map(aggregateRun(expenses).map((entry) => [entry.unitId, entry.totalCents]));
    const existing = await this.prisma.invoice.findMany({
      where: { buildingId, periodYearMonth },
    });
    const paidByUnitId = new Map(existing.map((invoice) => [invoice.unitId, invoice.paidCents]));

    await this.prisma.$transaction(
      building.units.map((unit) => {
        const totalCents = totals.get(unit.id) ?? 0;
        const paidCents = paidByUnitId.get(unit.id) ?? 0;
        const status =
          totalCents > 0 && paidCents >= totalCents
            ? PaymentStatus.PAID
            : PaymentStatus.PENDING;
        return this.prisma.invoice.upsert({
          where: {
            unitId_periodYearMonth: { unitId: unit.id, periodYearMonth },
          },
          create: {
            buildingId,
            unitId: unit.id,
            periodYearMonth,
            totalCents,
            paidCents,
            status,
          },
          update: { totalCents, status },
        });
      }),
    );

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'invoice.run',
      entity: 'invoice',
      entityId: periodYearMonth,
      metadata: { units: building.units.length },
    });

    void this.notifyOwners(buildingId, periodYearMonth);

    return this.listForPeriod(buildingId, periodYearMonth);
  }

  private async notifyOwners(
    buildingId: string,
    periodYearMonth: string,
  ): Promise<void> {
    const owners = await this.prisma.ownership.findMany({
      where: { unit: { buildingId } },
      select: { userId: true },
      distinct: ['userId'],
    });
    await this.notifications.createForUsers(
      owners.map((owner) => owner.userId),
      {
        type: 'invoice.issued',
        title: 'Νέο κοινοχρήστους λόγος',
        linkPath: '/balance',
        sms: { kind: 'invoice.issued', periodKey: periodYearMonth },
      },
    );
  }

  async listAdmin(
    buildingId: string,
    periodYearMonth: string | undefined,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);

    return this.prisma.invoice.findMany({
      where: {
        buildingId,
        ...(periodYearMonth ? { periodYearMonth } : {}),
      },
      include: INVOICE_WITH_UNIT,
      orderBy: [{ periodYearMonth: 'desc' }, { unit: { label: 'asc' } }],
    });
  }

  async findMine(
    periodYearMonth: string | undefined,
    user: AuthenticatedUser,
  ) {
    const ownerships = await this.prisma.ownership.findMany({
      where: { userId: user.id },
      select: { unitId: true },
    });
    const unitIds = ownerships.map((ownership) => ownership.unitId);
    if (unitIds.length === 0) {
      throw new ForbiddenException('User owns no units');
    }

    return this.prisma.invoice.findMany({
      where: {
        unitId: { in: unitIds },
        ...(periodYearMonth ? { periodYearMonth } : {}),
      },
      include: INVOICE_WITH_UNIT,
      orderBy: { periodYearMonth: 'desc' },
    });
  }

  private listForPeriod(buildingId: string, periodYearMonth: string) {
    return this.prisma.invoice.findMany({
      where: { buildingId, periodYearMonth },
      include: INVOICE_WITH_UNIT,
      orderBy: { unit: { label: 'asc' } },
    });
  }
}
