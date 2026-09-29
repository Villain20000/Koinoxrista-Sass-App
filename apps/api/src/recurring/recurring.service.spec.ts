import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RecurringService } from './recurring.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

const user = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId: 'building-1',
  ...overrides,
});

const template = (overrides: Record<string, unknown> = {}) => ({
  id: 'tpl-1',
  buildingId: 'building-1',
  name: 'Καθαριότητα',
  categoryId: 'cat-1',
  amountCents: 1001,
  strategy: 'MILIMES',
  active: true,
  lastPeriod: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

type Tx = {
  expense: { create: jest.Mock };
  share: { createMany: jest.Mock };
  recurringExpense: { update: jest.Mock };
};

function makePrisma() {
  const tx: Tx = {
    expense: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: { description: string } }) =>
          Promise.resolve({ id: `expense-${data.description}`, data }),
        ),
    },
    share: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    recurringExpense: { update: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    recurringExpense: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    unit: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'unit-a', label: 'Α1', floor: 1, millimes: 600 },
        { id: 'unit-b', label: 'Β1', floor: 4, millimes: 400 },
      ]),
    },
    expenseCategory: { findFirst: jest.fn() },
    $transaction: jest.fn(
      (fn: (t: Tx) => Promise<unknown>) => fn(tx) as Promise<unknown>,
    ),
  };

  return { prisma, tx };
}

describe('RecurringService.generate', () => {
  let service: RecurringService;
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let tx: ReturnType<typeof makePrisma>['tx'];

  beforeEach(() => {
    ({ prisma, tx } = makePrisma());
    service = new RecurringService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
  });

  it('materializes due templates with exact largest-remainder shares', async () => {
    prisma.recurringExpense.findMany.mockResolvedValue([template()]);

    await expect(
      service.generate('building-1', '2026-08', user()),
    ).resolves.toEqual({ created: 1 });

    expect(tx.expense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildingId: 'building-1',
        categoryId: 'cat-1',
        description: 'Καθαριότητα',
        totalCents: 1001,
        periodYearMonth: '2026-08',
        createdById: 'admin-1',
      }),
    });
    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares).toEqual([
      { expenseId: 'expense-Καθαριότητα', unitId: 'unit-a', amountCents: 601 },
      { expenseId: 'expense-Καθαριότητα', unitId: 'unit-b', amountCents: 400 },
    ]);
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
    expect(tx.recurringExpense.update).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
      data: { lastPeriod: '2026-08' },
    });
  });

  it('weights every unit equally for UNITS templates', async () => {
    prisma.recurringExpense.findMany.mockResolvedValue([
      template({
        id: 'tpl-units',
        name: 'Πάγιο ρεύμα',
        amountCents: 101,
        strategy: 'UNITS',
        categoryId: 'cat-power',
      }),
    ]);

    await service.generate('building-1', '2026-08', user());

    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      amountCents: number;
    }>;
    expect(shares.map((s) => s.amountCents)).toEqual([51, 50]);
  });

  it('is idempotent: only templates with lastPeriod < period are due', async () => {
    await service.generate('building-1', '2026-08', user());

    expect(prisma.recurringExpense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          buildingId: 'building-1',
          active: true,
          OR: [{ lastPeriod: null }, { lastPeriod: { lt: '2026-08' } }],
        },
      }),
    );
  });

  it('creates nothing when every template is already up to date', async () => {
    await expect(
      service.generate('building-1', '2026-08', user()),
    ).resolves.toEqual({ created: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.unit.findMany).not.toHaveBeenCalled();
  });

  it('skips templates without a category without touching lastPeriod', async () => {
    prisma.recurringExpense.findMany.mockResolvedValue([
      template({ categoryId: null }),
    ]);

    await expect(
      service.generate('building-1', '2026-08', user()),
    ).resolves.toEqual({ created: 0 });

    expect(tx.expense.create).not.toHaveBeenCalled();
    expect(tx.share.createMany).not.toHaveBeenCalled();
    expect(tx.recurringExpense.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid period before touching the database', async () => {
    await expect(
      service.generate('building-1', '2026-13', user()),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.recurringExpense.findMany).not.toHaveBeenCalled();
  });

  it('throws Forbidden when the caller belongs to another building', async () => {
    await expect(
      service.generate('building-1', '2026-08', user({ buildingId: 'b-9' })),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.recurringExpense.findMany).not.toHaveBeenCalled();
  });
});

describe('RecurringService CRUD', () => {
  let service: RecurringService;
  let prisma: ReturnType<typeof makePrisma>['prisma'];

  beforeEach(() => {
    ({ prisma } = makePrisma());
    service = new RecurringService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
  });

  it('scopes the list to the caller building', async () => {
    await service.list('building-1', user());
    expect(prisma.recurringExpense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildingId: 'building-1' } }),
    );
  });

  it('rejects a foreign category on create', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        'building-1',
        {
          name: 'Τεστ',
          amountCents: 1000,
          strategy: 'MILIMES',
          categoryId: 'cat-x',
        },
        user(),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.recurringExpense.create).not.toHaveBeenCalled();
  });

  it('defaults active=true and persists the template', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-1',
      buildingId: 'building-1',
    });
    prisma.recurringExpense.create.mockResolvedValue(
      template({ active: true }),
    );

    await service.create(
      'building-1',
      {
        name: 'Ανελκυστήρας',
        amountCents: 8000,
        strategy: 'MILIMES',
        categoryId: 'cat-1',
      },
      user(),
    );

    expect(prisma.expenseCategory.findFirst).toHaveBeenCalledWith({
      where: { id: 'cat-1', buildingId: 'building-1' },
    });
    expect(prisma.recurringExpense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildingId: 'building-1',
        name: 'Ανελκυστήρας',
        amountCents: 8000,
        strategy: 'MILIMES',
        categoryId: 'cat-1',
      }),
      include: { category: true },
    });
  });

  it('updates only owned templates', async () => {
    prisma.recurringExpense.findFirst.mockResolvedValue(template());
    prisma.recurringExpense.update.mockResolvedValue(template({ active: false }));

    await service.update('building-1', 'tpl-1', { active: false }, user());

    expect(prisma.recurringExpense.update).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
      data: { active: false },
      include: { category: true },
    });
  });

  it('throws NotFound when updating a foreign or missing template', async () => {
    prisma.recurringExpense.findFirst.mockResolvedValue(null);

    await expect(
      service.update('building-1', 'tpl-9', { active: false }, user()),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.recurringExpense.update).not.toHaveBeenCalled();
  });

  it('deletes only owned templates', async () => {
    prisma.recurringExpense.findFirst.mockResolvedValue(template());
    prisma.recurringExpense.delete.mockResolvedValue(template());

    await service.remove('building-1', 'tpl-1', user());

    expect(prisma.recurringExpense.delete).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
    });
  });

  it('throws NotFound when deleting a foreign or missing template', async () => {
    prisma.recurringExpense.findFirst.mockResolvedValue(null);

    await expect(
      service.remove('building-1', 'tpl-9', user()),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.recurringExpense.delete).not.toHaveBeenCalled();
  });
});
