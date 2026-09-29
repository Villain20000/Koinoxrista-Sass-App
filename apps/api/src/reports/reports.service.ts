import { BadRequestException, Injectable } from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';

export const MIN_MONTHS = 3;
export const MAX_MONTHS = 24;
export const DEFAULT_MONTHS = 12;

export interface ReportPeriodPoint {
  periodYearMonth: string;
  invoicedCents: number;
  collectedCents: number;
  arrearsCents: number;
}

export interface ReportCategoryTotal {
  categoryName: string;
  totalCents: number;
}

export interface ReportTotals {
  invoicedCents: number;
  collectedCents: number;
  arrearsCents: number;
  collectionRatePct: number;
}

export interface ReportSummary {
  periods: ReportPeriodPoint[];
  expensesByCategory: ReportCategoryTotal[];
  totals: ReportTotals;
}

/** Parses the ?months= query parameter, defaulting to 12 (pure). */
export function parseMonths(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_MONTHS;
  }
  const months = Number(raw);
  if (
    !Number.isInteger(months) ||
    months < MIN_MONTHS ||
    months > MAX_MONTHS
  ) {
    throw new BadRequestException(
      `months must be an integer between ${MIN_MONTHS} and ${MAX_MONTHS}`,
    );
  }
  return months;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Ascending YYYY-MM window of `months` periods ending with `now`'s month (pure). */
export function periodWindow(months: number, now: Date): string[] {
  const periods: string[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  for (let i = 0; i < months; i += 1) {
    periods.unshift(`${year}-${pad2(month + 1)}`);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return periods;
}

/** Arrears never go negative: over-collection clamps to zero (pure). */
export function clampArrears(
  invoicedCents: number,
  collectedCents: number,
): number {
  return Math.max(0, invoicedCents - collectedCents);
}

/** Collection percentage rounded to whole digits, 0% when nothing invoiced (pure). */
export function collectionRatePct(
  collectedCents: number,
  invoicedCents: number,
): number {
  if (invoicedCents <= 0) {
    return 0;
  }
  return Math.round((collectedCents / invoicedCents) * 100);
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(
    buildingId: string,
    user: AuthenticatedUser,
    monthsRaw?: string,
    now: Date = new Date(),
  ): Promise<ReportSummary> {
    assertSameBuilding(user, buildingId);
    const months = parseMonths(monthsRaw);
    const periods = periodWindow(months, now);

    const [invoiceGroups, expenseGroups] = await Promise.all([
      this.prisma.invoice.groupBy({
        by: ['periodYearMonth'],
        where: { buildingId, periodYearMonth: { in: periods } },
        _sum: { totalCents: true, paidCents: true },
      }),
      this.prisma.expense.groupBy({
        by: ['categoryId'],
        where: { buildingId, periodYearMonth: { in: periods } },
        _sum: { totalCents: true },
      }),
    ]);

    const sumsByPeriod = new Map(
      invoiceGroups.map((group) => [group.periodYearMonth, group._sum]),
    );
    const points: ReportPeriodPoint[] = periods.map((periodYearMonth) => {
      const sums = sumsByPeriod.get(periodYearMonth);
      const invoicedCents = sums?.totalCents ?? 0;
      const collectedCents = sums?.paidCents ?? 0;
      return {
        periodYearMonth,
        invoicedCents,
        collectedCents,
        arrearsCents: clampArrears(invoicedCents, collectedCents),
      };
    });

    const expensesByCategory = await this.expensesForPeriods(
      buildingId,
      expenseGroups,
    );

    const totals = points.reduce<ReportTotals>(
      (acc, point) => ({
        invoicedCents: acc.invoicedCents + point.invoicedCents,
        collectedCents: acc.collectedCents + point.collectedCents,
        arrearsCents: acc.arrearsCents + point.arrearsCents,
        collectionRatePct: 0,
      }),
      {
        invoicedCents: 0,
        collectedCents: 0,
        arrearsCents: 0,
        collectionRatePct: 0,
      },
    );
    totals.collectionRatePct = collectionRatePct(
      totals.collectedCents,
      totals.invoicedCents,
    );

    return { periods: points, expensesByCategory, totals };
  }

  private async expensesForPeriods(
    buildingId: string,
    expenseGroups: Array<{ categoryId: string; _sum: { totalCents: number | null } }>,
  ): Promise<ReportCategoryTotal[]> {
    if (expenseGroups.length === 0) {
      return [];
    }
    const categories = await this.prisma.expenseCategory.findMany({
      where: { id: { in: expenseGroups.map((g) => g.categoryId) }, buildingId },
      select: { id: true, name: true },
    });
    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    return expenseGroups
      .map((group) => ({
        categoryName: nameById.get(group.categoryId) ?? 'Λοιπές δαπάνες',
        totalCents: group._sum.totalCents ?? 0,
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }
}
