import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type {
  AccountantAccessDto,
  AccountantBuildingDto,
  ApologismosDto,
  ArrearsReport,
} from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BudgetsService } from '../budgets/budgets.service';
import { ArrearsService } from '../payments/arrears.service';
import { ReportsService } from '../reports/reports.service';
import { ownerDisplayName, buildUnitStatement } from '../exports/statements';
import { ExportsService } from '../exports/exports.service';
import { PayoutsService } from '../payouts/payouts.service';
import { GrantAccountantDto } from './dto/grant-accountant.dto';
import { buildApologismos } from './apologismos';

const YEAR_REGEX = /^\d{4}$/;

/**
 * Read-only seat for external λογιστές. Every read first verifies an
 * `AccountantAccess` row for (user, building); reused domain services then see
 * a building-scoped synthetic session so their own tenant guards pass.
 */
@Injectable()
export class AccountantSeatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly budgets: BudgetsService,
    private readonly payouts: PayoutsService,
    private readonly arrears: ArrearsService,
    private readonly exportsService: ExportsService,
  ) {}

  // ── ADMIN: seat administration ────────────────────────────────────────────

  async listAccesses(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<AccountantAccessDto[]> {
    assertSameBuilding(user, buildingId);

    const accesses = await this.prisma.accountantAccess.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'desc' },
      include: {
        accountant: { select: { email: true, firstName: true, lastName: true } },
      },
    });

    return accesses.map((access) => ({
      id: access.id,
      accountantId: access.accountantId,
      accountantEmail: access.accountant.email,
      accountantFirstName: access.accountant.firstName,
      accountantLastName: access.accountant.lastName,
      buildingId: access.buildingId,
      grantedById: access.grantedById,
      createdAt: access.createdAt.toISOString(),
    }));
  }

  async grant(
    buildingId: string,
    dto: GrantAccountantDto,
    user: AuthenticatedUser,
  ): Promise<AccountantAccessDto> {
    assertSameBuilding(user, buildingId);
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true },
    });
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    const accountant = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, role: true },
    });
    if (!accountant) {
      throw new NotFoundException('No user with this email');
    }
    if (accountant.role !== Role.ACCOUNTANT) {
      throw new ConflictException('User role must be ACCOUNTANT');
    }

    try {
      const access = await this.prisma.accountantAccess.create({
        data: {
          accountantId: accountant.id,
          buildingId,
          grantedById: user.id,
        },
        include: {
          accountant: {
            select: { email: true, firstName: true, lastName: true },
          },
        },
      });
      this.audit.record({
        buildingId,
        actorId: user.id,
        actorRole: user.role,
        action: 'accountant-access.grant',
        entity: 'accountant_access',
        entityId: access.id,
        metadata: { accountantId: accountant.id },
      });
      return {
        id: access.id,
        accountantId: access.accountantId,
        accountantEmail: access.accountant.email,
        accountantFirstName: access.accountant.firstName,
        accountantLastName: access.accountant.lastName,
        buildingId: access.buildingId,
        grantedById: access.grantedById,
        createdAt: access.createdAt.toISOString(),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Accountant already has access');
      }
      throw error;
    }
  }

  async revoke(
    buildingId: string,
    accessId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    assertSameBuilding(user, buildingId);
    const access = await this.prisma.accountantAccess.findFirst({
      where: { id: accessId, buildingId },
    });
    if (!access) {
      throw new NotFoundException('Accountant access not found');
    }
    await this.prisma.accountantAccess.delete({ where: { id: access.id } });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'accountant-access.revoke',
      entity: 'accountant_access',
      entityId: access.id,
      metadata: { accountantId: access.accountantId },
    });
  }

  // ── ACCOUNTANT: read-only financial views ─────────────────────────────────

  /** 403s unless the caller holds an AccountantAccess seat for the building. */
  private async requireAccess(
    userId: string,
    buildingId: string,
  ): Promise<void> {
    const access = await this.prisma.accountantAccess.findUnique({
      where: { accountantId_buildingId: { accountantId: userId, buildingId } },
      select: { id: true },
    });
    if (!access) {
      throw new ForbiddenException('No accountant access to this building');
    }
  }

  /**
   * Reused domain services guard with `assertSameBuilding`; the accountant's
   * JWT may not carry the building context yet, so reads run as a synthetic
   * session scoped to the granted building.
   */
  private async actor(
    user: AuthenticatedUser,
    buildingId: string,
  ): Promise<AuthenticatedUser> {
    await this.requireAccess(user.id, buildingId);
    return { ...user, buildingId };
  }

  async listBuildings(
    user: AuthenticatedUser,
  ): Promise<AccountantBuildingDto[]> {
    const accesses = await this.prisma.accountantAccess.findMany({
      where: { accountantId: user.id },
      orderBy: { building: { name: 'asc' } },
      select: {
        buildingId: true,
        building: { select: { name: true, address: true } },
      },
    });
    return accesses.map((access) => ({
      buildingId: access.buildingId,
      name: access.building.name,
      address: access.building.address,
    }));
  }

  async summary(buildingId: string, user: AuthenticatedUser, months?: string) {
    return this.reports.summary(buildingId, await this.actor(user, buildingId), months);
  }

  async statement(
    buildingId: string,
    year: string,
    unitId: string,
    user: AuthenticatedUser,
  ) {
    return this.exportsService.unitStatement(
      buildingId,
      unitId,
      year,
      await this.actor(user, buildingId),
    );
  }

  async payoutsSummary(buildingId: string, year: number, user: AuthenticatedUser) {
    return this.payouts.summary(buildingId, await this.actor(user, buildingId), year);
  }

  async arrearsReport(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<ArrearsReport> {
    return this.arrears.getArrears(buildingId, await this.actor(user, buildingId));
  }

  /**
   * Year-end απολογισμός pack. Reuses the budget-compare service (planned vs
   * actual), raw invoice rows for the calendar-year series, and the statements
   * engine (buildUnitStatement) for per-unit closing balances.
   */
  async apologismos(
    buildingId: string,
    yearRaw: string | undefined,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<ApologismosDto> {
    const year = yearRaw === undefined || yearRaw === ''
      ? String(now.getUTCFullYear())
      : yearRaw;
    if (!YEAR_REGEX.test(year)) {
      throw new BadRequestException('year must match YYYY');
    }
    const session = await this.actor(user, buildingId);

    const [building, compare, expenseGroups, invoices, units, expenses, ownerships] =
      await Promise.all([
        this.prisma.building.findUnique({
          where: { id: buildingId },
          select: { name: true },
        }),
        this.budgets.compare(buildingId, Number(year), session),
        this.prisma.expense.groupBy({
          by: ['categoryId'],
          where: { buildingId, periodYearMonth: { startsWith: `${year}-` } },
          _sum: { totalCents: true },
        }),
        this.prisma.invoice.findMany({
          where: { buildingId, periodYearMonth: { startsWith: `${year}-` } },
          select: {
            periodYearMonth: true,
            totalCents: true,
            paidCents: true,
            unitId: true,
          },
        }),
        this.prisma.unit.findMany({
          where: { buildingId },
          orderBy: { label: 'asc' },
          select: { id: true, label: true },
        }),
        this.prisma.expense.findMany({
          where: { buildingId, periodYearMonth: { startsWith: `${year}-` } },
          include: { shares: true },
          orderBy: [{ periodYearMonth: 'asc' }, { description: 'asc' }],
        }),
        this.prisma.ownership.findMany({
          where: { unit: { buildingId } },
          select: {
            unitId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        }),
      ]);
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    const ownersByUnit = new Map<string, string[]>();
    for (const ownership of ownerships) {
      const name = ownerDisplayName([ownership.user]);
      if (!name) continue;
      const names = ownersByUnit.get(ownership.unitId) ?? [];
      names.push(name);
      ownersByUnit.set(ownership.unitId, names);
    }
    const ownerNameOf = (unitId: string): string | undefined => {
      const names = [...new Set(ownersByUnit.get(unitId) ?? [])];
      return names.length > 0 ? names.join(', ') : undefined;
    };

    const unitBalances = units.map((unit) => {
      const statement = buildUnitStatement({
        buildingName: building.name,
        unitId: unit.id,
        unitLabel: unit.label,
        ...(ownerNameOf(unit.id) ? { ownerName: ownerNameOf(unit.id) } : {}),
        year,
        expenses,
        invoices,
      });
      return {
        unitId: unit.id,
        unitLabel: unit.label,
        ...(statement.ownerName ? { ownerName: statement.ownerName } : {}),
        invoicedCents: statement.totals.invoicedCents,
        paidCents: statement.totals.paidCents,
        balanceCents: statement.totals.balanceCents,
      };
    });

    return buildApologismos({
      buildingId,
      buildingName: building.name,
      year,
      generatedAt: now,
      expenseGroups,
      budgetRows: compare.lines.map((line) => ({
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        plannedCents: line.plannedCents,
      })),
      invoices,
      unitBalances,
    });
  }
}
