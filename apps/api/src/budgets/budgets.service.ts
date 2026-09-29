import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import {
  BudgetCompareResponseDto,
  BudgetCompareRowDto,
} from '@org/shared';
import { CreateBudgetLineDto } from './dto/create-budget-line.dto';
import { UpdateBudgetLineDto } from './dto/update-budget-line.dto';

/** Row name for budget lines that carry no expense category. */
export const UNCATEGORIZED_ROW_NAME = 'Λοιπές (χωρίς κατηγορία)';

/** Fallback for expense groups whose category row went missing. */
const UNKNOWN_CATEGORY_NAME = 'Λοιπές δαπάνες';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Ascending `YYYY-01`…`YYYY-12` window; matches reports-style period filtering. */
export function yearPeriods(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
}

export interface BudgetLineAggregateInput {
  id: string;
  categoryId: string | null;
  name: string;
  plannedCents: number;
  category?: { name: string } | null;
}

export interface ExpenseGroupInput {
  categoryId: string;
  _sum: { totalCents: number | null };
}

/**
 * Row granularity: ONE ROW PER CATEGORY. Budget lines are aggregated by
 * categoryId (uncategorized ones roll into a single null-keyed row), then
 * joined with the year's actual expense totals per category. Categories with
 * expenses but no budget line appear with plannedCents = 0; budget-only rows
 * keep actualCents = 0. Sorted by Greek collation, uncategorized row last.
 */
export function buildBudgetCompare(
  year: number,
  lines: BudgetLineAggregateInput[],
  expenseGroups: ExpenseGroupInput[],
  categoryNames: Record<string, string>,
): BudgetCompareResponseDto {
  const plannedByKey = new Map<string | null, number>();  for (const line of lines) {
    plannedByKey.set(
      line.categoryId,
      (plannedByKey.get(line.categoryId) ?? 0) + line.plannedCents,
    );
  }

  const actualById = new Map<string | null, number>();
  for (const group of expenseGroups) {
    actualById.set(
      group.categoryId,
      (actualById.get(group.categoryId) ?? 0) + (group._sum.totalCents ?? 0),
    );
  }

  const keys = new Set<string | null>([
    ...plannedByKey.keys(),
    ...actualById.keys(),
  ]);

  const rows: BudgetCompareRowDto[] = [...keys].map((key) => {
    const categoryId = key ?? null;
    const categoryName =
      key === null
        ? UNCATEGORIZED_ROW_NAME
        : (categoryNames[key] ?? UNKNOWN_CATEGORY_NAME);
    return {
      categoryId,
      categoryName,
      plannedCents: plannedByKey.get(key) ?? 0,
      actualCents: actualById.get(key) ?? 0,
    };
  });

  const backingLines = new Map<string | null, string[]>();
  for (const line of lines) {
    const names = backingLines.get(line.categoryId) ?? [];
    names.push(line.name);
    backingLines.set(line.categoryId, names);
  }
  for (const row of rows) {
    const names = backingLines.get(row.categoryId);
    if (names?.length === 1) {
      row.name = names[0];
    }
  }

  rows.sort((a, b) => {
    if (a.categoryId === null) return 1;
    if (b.categoryId === null) return -1;
    return a.categoryName.localeCompare(b.categoryName, 'el');
  });

  const totals = rows.reduce(
    (acc, row) => ({
      plannedCents: acc.plannedCents + row.plannedCents,
      actualCents: acc.actualCents + row.actualCents,
    }),
    { plannedCents: 0, actualCents: 0 },
  );

  return { year, lines: rows, totals };
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(buildingId: string, year: number, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);

    return this.prisma.budgetLine.findMany({
      where: { buildingId, year },
      include: { category: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(
    buildingId: string,
    dto: CreateBudgetLineDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    await this.assertCategory(buildingId, dto.categoryId);

    try {
      return await this.prisma.budgetLine.create({
        data: {
          buildingId,
          year: dto.year,
          name: dto.name,
          plannedCents: dto.plannedCents,
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        },
        include: { category: { select: { name: true } } },
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException(
          'A budget line with this name already exists for the year',
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateBudgetLineDto, user: AuthenticatedUser) {
    const line = await this.findOwned(user.buildingId, id);
    await this.assertCategory(line.buildingId, dto.categoryId);

    try {
      return await this.prisma.budgetLine.update({
        where: { id: line.id },
        data: {
          ...(dto.year !== undefined ? { year: dto.year } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.plannedCents !== undefined
            ? { plannedCents: dto.plannedCents }
            : {}),
          ...(dto.categoryId !== undefined
            ? { categoryId: dto.categoryId }
            : {}),
        },
        include: { category: { select: { name: true } } },
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException(
          'A budget line with this name already exists for the year',
        );
      }
      throw error;
    }
  }

  async remove(id: string, user: AuthenticatedUser) {
    const line = await this.findOwned(user.buildingId, id);
    await this.prisma.budgetLine.delete({ where: { id: line.id } });
  }

  async compare(
    buildingId: string,
    year: number,
    user: AuthenticatedUser,
  ): Promise<BudgetCompareResponseDto> {
    assertSameBuilding(user, buildingId);
    const periods = yearPeriods(year);

    const [lines, expenseGroups] = await Promise.all([
      this.prisma.budgetLine.findMany({
        where: { buildingId, year },
        include: { category: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.expense.groupBy({
        by: ['categoryId'],
        where: { buildingId, periodYearMonth: { in: periods } },
        _sum: { totalCents: true },
      }),
    ]);

    const categoryIds = [
      ...new Set([
        ...lines.map((line) => line.categoryId),
        ...expenseGroups.map((group) => group.categoryId),
      ]),
    ].filter((id): id is string => id !== null);
    const categories = categoryIds.length
      ? await this.prisma.expenseCategory.findMany({
          where: { id: { in: categoryIds }, buildingId },
          select: { id: true, name: true },
        })
      : [];
    const categoryNames = Object.fromEntries(
      categories.map((category) => [category.id, category.name]),
    );

    return buildBudgetCompare(year, lines, expenseGroups, categoryNames);
  }

  private async findOwned(buildingId: string | null, id: string) {
    if (!buildingId) {
      throw new NotFoundException('Budget line not found');
    }
    const line = await this.prisma.budgetLine.findFirst({
      where: { id, buildingId },
    });
    if (!line) {
      throw new NotFoundException('Budget line not found');
    }
    return line;
  }

  private async assertCategory(
    buildingId: string,
    categoryId: string | undefined,
  ): Promise<void> {
    if (categoryId === undefined) {
      return;
    }
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: categoryId, buildingId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }
}
