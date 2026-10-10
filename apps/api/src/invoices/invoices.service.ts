import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ChargePayer, PaymentStatus, Prisma } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { TOTAL_MILLIMES } from '@org/shared';
import {
  assertSameBuilding,
  requireValidPeriod,
} from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { aggregateRunByPayer } from './run-invoices';
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
      select: {
        chargeTo: true,
        shares: { select: { unitId: true, amountCents: true } },
      },
    });
    if (expenses.length === 0) {
      throw new BadRequestException('no expenses for period');
    }

    const key = (unitId: string, payer: ChargePayer) => `${unitId}|${payer}`;
    const totals = new Map(
      aggregateRunByPayer(expenses).map((entry) => [
        key(entry.unitId, entry.payer),
        entry.totalCents,
      ]),
    );
    const existing = await this.prisma.invoice.findMany({
      where: { buildingId, periodYearMonth },
    });
    const paidByKey = new Map(
      existing.map((invoice) => [key(invoice.unitId, invoice.payer), invoice.paidCents]),
    );

    // Every unit always gets an occupant invoice (even €0, as before); an
    // owner invoice is only created when owner-borne charges exist (or one
    // was issued earlier and must be re-totalled).
    const targets: Array<{ unitId: string; payer: ChargePayer }> = [];
    for (const unit of building.units) {
      targets.push({ unitId: unit.id, payer: ChargePayer.OCCUPANT });
      const ownerKey = key(unit.id, ChargePayer.OWNER);
      if (totals.has(ownerKey) || paidByKey.has(ownerKey)) {
        targets.push({ unitId: unit.id, payer: ChargePayer.OWNER });
      }
    }

    await this.prisma.$transaction(
      targets.map(({ unitId, payer }) => {
        const totalCents = totals.get(key(unitId, payer)) ?? 0;
        const paidCents = paidByKey.get(key(unitId, payer)) ?? 0;
        const status =
          totalCents > 0 && paidCents >= totalCents
            ? PaymentStatus.PAID
            : PaymentStatus.PENDING;
        return this.prisma.invoice.upsert({
          where: {
            unitId_periodYearMonth_payer: { unitId, periodYearMonth, payer },
          },
          create: {
            buildingId,
            unitId,
            periodYearMonth,
            payer,
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
      metadata: { units: building.units.length, invoices: targets.length },
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
        title: 'Νέο ειδοποιητήριο κοινοχρήστων',
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
      select: { unitId: true, occupantType: true },
    });
    if (ownerships.length === 0) {
      throw new ForbiddenException('User owns no units');
    }
    const unitIds = [...new Set(ownerships.map((ownership) => ownership.unitId))];
    const tenantRows = await this.prisma.ownership.findMany({
      where: { unitId: { in: unitIds }, occupantType: 'TENANT' },
      select: { unitId: true, userId: true },
    });
    const visibility = visibleInvoiceFilters(user.id, ownerships, tenantRows);

    return this.prisma.invoice.findMany({
      where: {
        OR: visibility,
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
      orderBy: [{ unit: { label: 'asc' } }, { payer: 'asc' }],
    });
  }
}

/**
 * Which invoices a resident sees on /balance:
 *  - a TENANT sees only the occupant invoice of the units they rent;
 *  - an OWNER sees the owner invoice, plus the occupant invoice when nobody
 *    else is registered as tenant of that unit (owner-occupied).
 */
export function visibleInvoiceFilters(
  userId: string,
  ownerships: Array<{ unitId: string; occupantType: string }>,
  tenantRows: Array<{ unitId: string; userId: string }>,
): Prisma.InvoiceWhereInput[] {
  const rentedOut = new Set(
    tenantRows.filter((row) => row.userId !== userId).map((row) => row.unitId),
  );
  const filters: Prisma.InvoiceWhereInput[] = [];
  for (const { unitId, occupantType } of ownerships) {
    if (occupantType === 'TENANT') {
      filters.push({ unitId, payer: ChargePayer.OCCUPANT });
    } else if (rentedOut.has(unitId)) {
      filters.push({ unitId, payer: ChargePayer.OWNER });
    } else {
      filters.push({ unitId });
    }
  }
  return filters;
}
