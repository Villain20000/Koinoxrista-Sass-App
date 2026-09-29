import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { ArrearsService } from '../payments/arrears.service';
import { buildLedgerRows, ledgerTotals } from './build-ledger';
import { toCsv } from './csv';
import { renderReceiptHtml } from './render-receipt';
import {
  UnitYearStatement,
  buildUnitStatement,
  ownerDisplayName,
} from './statements';

export interface CsvFile {
  body: string;
  contentType: string;
  filename: string;
}

const YEAR_REGEX = /^\d{4}$/;

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arrearsService: ArrearsService,
  ) {}

  async ledgerCsv(
    buildingId: string,
    year: string | undefined,
    user: AuthenticatedUser,
  ): Promise<CsvFile> {
    assertSameBuilding(user, buildingId);
    if (!year || !YEAR_REGEX.test(year)) {
      throw new BadRequestException('year must match YYYY');
    }

    const [expenses, units, invoices] = await Promise.all([
      this.prisma.expense.findMany({
        where: { buildingId, periodYearMonth: { startsWith: `${year}-` } },
        include: { shares: true },
      }),
      this.prisma.unit.findMany({ where: { buildingId } }),
      this.prisma.invoice.findMany({
        where: { buildingId, periodYearMonth: { startsWith: `${year}-` } },
      }),
    ]);

    const rows = buildLedgerRows(year, expenses, units, invoices);
    const totals = ledgerTotals(rows);
    const body = toCsv(
      ['periodYearMonth', 'unitLabel', 'description', 'invoicedCents', 'paidCents', 'balanceCents'],
      [
        ...rows.map((row) => [
          row.periodYearMonth,
          row.unitLabel,
          row.description,
          row.invoicedCents,
          row.paidCents,
          row.balanceCents,
        ]),
        ['ΣΥΝΟΛΟ', '', '', totals.invoicedCents, totals.paidCents, totals.balanceCents],
      ],
    );
    return {
      body,
      contentType: 'text/csv;charset=utf-8',
      filename: `koinoxrista-${year}.csv`,
    };
  }

  async arrearsCsv(
    buildingId: string,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<CsvFile> {
    const report = await this.arrearsService.getArrears(buildingId, user, now);
    const body = toCsv(
      [
        'unitId',
        'unitLabel',
        'ownerNames',
        'outstandingCents',
        'bucketCurrentCents',
        'bucket30Cents',
        'bucket60Cents',
        'bucket90PlusCents',
        'oldestUnpaidPeriod',
      ],
      [
        ...report.rows.map((row) => [
          row.unitId,
          row.unitLabel,
          row.ownerNames.join(', '),
          row.outstandingCents,
          row.bucketCurrentCents,
          row.bucket30Cents,
          row.bucket60Cents,
          row.bucket90PlusCents,
          row.oldestUnpaidPeriod ?? '',
        ]),
        [
          'ΣΥΝΟΛΟ',
          '',
          '',
          report.totalOutstandingCents,
          report.rows.reduce((sum, row) => sum + row.bucketCurrentCents, 0),
          report.rows.reduce((sum, row) => sum + row.bucket30Cents, 0),
          report.rows.reduce((sum, row) => sum + row.bucket60Cents, 0),
          report.rows.reduce((sum, row) => sum + row.bucket90PlusCents, 0),
          '',
        ],
      ],
    );
    const date = now.toISOString().slice(0, 10);
    return {
      body,
      contentType: 'text/csv;charset=utf-8',
      filename: `koinoxrista-arrears-${date}.csv`,
    };
  }

  async receiptHtml(invoiceId: string, user: AuthenticatedUser): Promise<CsvFile> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        payments: { orderBy: { createdAt: 'asc' } },
        unit: { include: { building: { select: { name: true } } } },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    await this.assertReceiptAccess(invoice.buildingId, invoice.unitId, user);

    return {
      body: renderReceiptHtml({
        buildingName: invoice.unit.building.name,
        unitLabel: invoice.unit.label,
        periodYearMonth: invoice.periodYearMonth,
        totalCents: invoice.totalCents,
        paidCents: invoice.paidCents,
        payments: invoice.payments.map((payment) => ({
          createdAt: payment.createdAt,
          method: payment.method,
          pspRef: payment.pspRef,
          amountCents: payment.amountCents,
        })),
        generatedAt: new Date(),
      }),
      contentType: 'text/html;charset=utf-8',
      filename: `apodeiksi-${invoice.periodYearMonth}-${invoice.unit.label}.html`,
    };
  }

  async unitStatement(
    buildingId: string,
    unitId: string,
    year: string,
    user: AuthenticatedUser,
  ): Promise<UnitYearStatement> {
    assertSameBuilding(user, buildingId);
    if (!YEAR_REGEX.test(year)) {
      throw new BadRequestException('year must match YYYY');
    }
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { name: true },
    });
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, buildingId },
      select: { id: true, label: true },
    });
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }
    return this.buildStatement(
      buildingId,
      building.name,
      unit.id,
      unit.label,
      year,
    );
  }

  async myUnitStatement(
    year: string,
    user: AuthenticatedUser,
  ): Promise<UnitYearStatement> {
    if (!YEAR_REGEX.test(year)) {
      throw new BadRequestException('year must match YYYY');
    }
    const units = await this.prisma.unit.findMany({
      where: { ownerships: { some: { userId: user.id } } },
      orderBy: { label: 'asc' },
      select: { id: true, label: true, buildingId: true },
    });
    const unit = units[0];
    if (!unit) {
      throw new ForbiddenException('User owns no units');
    }
    const building = await this.prisma.building.findUnique({
      where: { id: unit.buildingId },
      select: { name: true },
    });
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    return this.buildStatement(
      unit.buildingId,
      building.name,
      unit.id,
      unit.label,
      year,
    );
  }

  private async buildStatement(
    buildingId: string,
    buildingName: string,
    unitId: string,
    unitLabel: string,
    year: string,
  ): Promise<UnitYearStatement> {
    const [expenses, invoices, ownerships] = await Promise.all([
      this.prisma.expense.findMany({
        where: { buildingId, periodYearMonth: { startsWith: `${year}-` } },
        include: { shares: true },
        orderBy: [{ periodYearMonth: 'asc' }, { description: 'asc' }],
      }),
      this.prisma.invoice.findMany({
        where: { buildingId, unitId, periodYearMonth: { startsWith: `${year}-` } },
        select: { unitId: true, periodYearMonth: true, paidCents: true },
      }),
      this.prisma.ownership.findMany({
        where: { unitId },
        include: { user: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    return buildUnitStatement({
      buildingName,
      unitId,
      unitLabel,
      ownerName: ownerDisplayName(ownerships.map((o) => o.user)),
      year,
      expenses,
      invoices,
    });
  }

  private async assertReceiptAccess(
    buildingId: string,
    unitId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    assertSameBuilding(user, buildingId);
    if (user.role === 'ADMIN') return;
    const ownership = await this.prisma.ownership.findFirst({
      where: { userId: user.id, unitId },
    });
    if (!ownership) {
      throw new ForbiddenException('You do not own this unit');
    }
  }
}
