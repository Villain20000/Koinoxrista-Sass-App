import { ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildBudgetCompare,
  BudgetLineAggregateInput,
  BudgetsService,
  UNCATEGORIZED_ROW_NAME,
  yearPeriods,
} from './budgets.service';

function makePrisma() {
  return {
    budgetLine: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    expenseCategory: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    expense: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
}

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@b.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

describe('yearPeriods', () => {
  it('builds the twelve YYYY-MM periods of a year', () => {
    expect(yearPeriods(2026)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
  });
});

describe('buildBudgetCompare', () => {
  const names = { 'cat-clean': 'Καθαριότητα', 'cat-lift': 'Ανελκυστήρας' };
  const line = (
    overrides: Partial<BudgetLineAggregateInput>,
  ): BudgetLineAggregateInput => ({
    id: 'line-1',
    categoryId: null,
    name: 'Γραμμή',
    plannedCents: 0,
    ...overrides,
  });

  it('aggregates multiple budget lines of one category into a single row', () => {
    const result = buildBudgetCompare(
      2026,
      [
        line({ id: 'a', categoryId: 'cat-clean', name: 'Δύο', plannedCents: 100 }),
        line({ id: 'b', categoryId: 'cat-clean', name: 'Ένα', plannedCents: 50 }),
        line({ id: 'c', categoryId: 'cat-lift', name: 'Συντήρηση', plannedCents: 200 }),
      ],
      [],
      names,
    );

    expect(result.year).toBe(2026);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      categoryId: 'cat-lift',
      categoryName: 'Ανελκυστήρας',
      plannedCents: 200,
      actualCents: 0,
    });
    expect(result.lines[1]).toMatchObject({
      categoryId: 'cat-clean',
      plannedCents: 150,
      actualCents: 0,
    });
    expect(result.totals).toEqual({ plannedCents: 350, actualCents: 0 });
  });

  it('rolls uncategorized budget lines into one null-keyed row placed last', () => {
    const result = buildBudgetCompare(
      2026,
      [
        line({ id: 'a', categoryId: null, name: 'Άλλα', plannedCents: 30 }),
        line({ id: 'b', categoryId: 'cat-clean', name: 'Καθαριότητα', plannedCents: 10 }),
        line({ id: 'c', categoryId: null, name: 'Επείγοντα', plannedCents: 20 }),
      ],
      [],
      names,
    );

    expect(result.lines.map((row) => row.categoryId)).toEqual([
      'cat-clean',
      null,
    ]);
    const uncategorized = result.lines[1];
    expect(uncategorized.categoryName).toBe(UNCATEGORIZED_ROW_NAME);
    expect(uncategorized.plannedCents).toBe(50);
  });

  it('attributes actual expenses per category; expense-only rows get zero planned', () => {
    const result = buildBudgetCompare(
      2026,
      [line({ categoryId: 'cat-clean', plannedCents: 1_000 })],
      [
        { categoryId: 'cat-clean', _sum: { totalCents: 400 } },
        { categoryId: 'cat-new', _sum: { totalCents: 250 } },
      ],
      { ...names, 'cat-new': 'Ρεύμα κοινόχρηστο' },
    );

    expect(result.lines).toEqual([
      {
        categoryId: 'cat-clean',
        categoryName: 'Καθαριότητα',
        name: 'Γραμμή',
        plannedCents: 1_000,
        actualCents: 400,
      },
      {
        categoryId: 'cat-new',
        categoryName: 'Ρεύμα κοινόχρηστο',
        plannedCents: 0,
        actualCents: 250,
      },
    ]);
    expect(result.totals).toEqual({ plannedCents: 1_000, actualCents: 650 });
  });

  it('is zero-safe for empty years — no rows, zero totals', () => {
    const result = buildBudgetCompare(2030, [], [], {});
    expect(result).toEqual({
      year: 2030,
      lines: [],
      totals: { plannedCents: 0, actualCents: 0 },
    });
  });
});

describe('BudgetsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: BudgetsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new BudgetsService(prisma as unknown as PrismaService);
  });

  describe('list', () => {
    it('returns the year lines ordered by name with category names', async () => {
      const rows = [{ id: 'line-1' }];
      prisma.budgetLine.findMany.mockResolvedValue(rows);

      await expect(service.list('building-1', 2026, user)).resolves.toBe(rows);
      expect(prisma.budgetLine.findMany).toHaveBeenCalledWith({
        where: { buildingId: 'building-1', year: 2026 },
        include: { category: { select: { name: true } } },
        orderBy: { name: 'asc' },
      });
    });

    it('forbids another building', async () => {
      await expect(
        service.list('building-2', 2026, user),
      ).rejects.toThrow(/another building/i);
    });
  });

  describe('create', () => {
    it('creates a line scoped to the building and resolves its category', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 'cat-clean',
        buildingId: 'building-1',
      });
      prisma.budgetLine.create.mockResolvedValue({ id: 'line-1' });

      await expect(
        service.create(
          'building-1',
          { year: 2026, name: 'Καθαριότητα', plannedCents: 1_000, categoryId: 'cat-clean' },
          user,
        ),
      ).resolves.toEqual({ id: 'line-1' });

      expect(prisma.budgetLine.create).toHaveBeenCalledWith({
        data: {
          buildingId: 'building-1',
          year: 2026,
          name: 'Καθαριότητα',
          plannedCents: 1_000,
          categoryId: 'cat-clean',
        },
        include: { category: { select: { name: true } } },
      });
    });

    it('creates an uncategorized line without touching categories', async () => {
      prisma.budgetLine.create.mockResolvedValue({ id: 'line-2' });

      await service.create(
        'building-1',
        { year: 2026, name: 'Λοιπές', plannedCents: 5_000 },
        user,
      );

      expect(prisma.expenseCategory.findFirst).not.toHaveBeenCalled();
      expect(prisma.budgetLine.create.mock.calls[0][0].data).not.toHaveProperty(
        'categoryId',
      );
    });

    it('rejects unknown categories', async () => {
      await expect(
        service.create(
          'building-1',
          { year: 2026, name: 'Χ', plannedCents: 1, categoryId: 'missing' },
          user,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps P2002 to 409 ConflictException', async () => {
      prisma.budgetLine.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create(
          'building-1',
          { year: 2026, name: 'Διπλή', plannedCents: 1 },
          user,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    const existing = {
      id: 'line-1',
      buildingId: 'building-1',
      year: 2026,
      name: 'Καθαριότητα',
      plannedCents: 1_000,
      categoryId: null,
    };

    it('patches only provided fields on an owned line', async () => {
      prisma.budgetLine.findFirst.mockResolvedValue(existing);
      prisma.budgetLine.update.mockResolvedValue({ ...existing, plannedCents: 2_000 });

      await expect(
        service.update('line-1', { plannedCents: 2_000 }, user),
      ).resolves.toMatchObject({ plannedCents: 2_000 });

      expect(prisma.budgetLine.update).toHaveBeenCalledWith({
        where: { id: 'line-1' },
        data: { plannedCents: 2_000 },
        include: { category: { select: { name: true } } },
      });
    });

    it('throws NotFound for foreign or missing lines (tenancy)', async () => {
      prisma.budgetLine.findFirst.mockResolvedValue(null);

      await expect(
        service.update('line-9', { plannedCents: 1 }, user),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps rename collisions to 409', async () => {
      prisma.budgetLine.findFirst.mockResolvedValue(existing);
      prisma.budgetLine.update.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.update('line-1', { name: 'Υπάρχουσα' }, user),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('deletes an owned line', async () => {
      prisma.budgetLine.findFirst.mockResolvedValue({
        id: 'line-1',
        buildingId: 'building-1',
      });

      await service.remove('line-1', user);

      expect(prisma.budgetLine.delete).toHaveBeenCalledWith({
        where: { id: 'line-1' },
      });
    });
  });

  describe('compare', () => {
    it('groups expenses over the year window and joins category names', async () => {
      prisma.budgetLine.findMany.mockResolvedValue([
        {
          id: 'line-1',
          categoryId: 'cat-clean',
          name: 'Καθαριότητα',
          plannedCents: 1_800,
          category: { name: 'Καθαριότητα' },
        },
      ]);
      prisma.expense.groupBy.mockResolvedValue([
        { categoryId: 'cat-clean', _sum: { totalCents: 1_500 } },
      ]);
      prisma.expenseCategory.findMany.mockResolvedValue([
        { id: 'cat-clean', name: 'Καθαριότητα' },
      ]);

      await expect(service.compare('building-1', 2026, user)).resolves.toEqual({
        year: 2026,
        lines: [
          {
            categoryId: 'cat-clean',
            categoryName: 'Καθαριότητα',
            name: 'Καθαριότητα',
            plannedCents: 1_800,
            actualCents: 1_500,
          },
        ],
        totals: { plannedCents: 1_800, actualCents: 1_500 },
      });

      const groupCall = prisma.expense.groupBy.mock.calls[0][0];
      expect(groupCall.where).toMatchObject({
        buildingId: 'building-1',
        periodYearMonth: { in: yearPeriods(2026) },
      });
    });

    it('skips the category lookup when there is nothing to name', async () => {
      await expect(
        service.compare('building-1', 2026, user),
      ).resolves.toEqual({
        year: 2026,
        lines: [],
        totals: { plannedCents: 0, actualCents: 0 },
      });
      expect(prisma.expenseCategory.findMany).not.toHaveBeenCalled();
    });

    it('forbids another building', async () => {
      await expect(
        service.compare('building-2', 2026, user),
      ).rejects.toThrow(/another building/i);
    });
  });
});
