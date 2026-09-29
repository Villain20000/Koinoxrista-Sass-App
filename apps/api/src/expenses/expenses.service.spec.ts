import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AllocationStrategy } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetersService } from '../meters/meters.service';
import { resolveAllocationWeights } from './allocation-weights';
import { ExpensesService } from './expenses.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

const metersStub = (): MetersService =>
  ({
    buildUnitConsumptions: jest.fn().mockResolvedValue([]),
  }) as unknown as MetersService;

const user = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId: 'building-1',
  ...overrides,
});

type Tx = {
  expense: { create: jest.Mock; findUniqueOrThrow: jest.Mock };
  share: { createMany: jest.Mock };
};

function makePrisma() {
  const tx: Tx = {
    expense: {
      create: jest.fn().mockResolvedValue({ id: 'expense-1' }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'expense-1', shares: [] }),
    },
    share: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const prisma = {
    expenseCategory: { findFirst: jest.fn() },
    unit: { findMany: jest.fn() },
    expense: {
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'expense-1', shares: [] }),
    },
    $transaction: jest.fn((fn: (t: Tx) => Promise<unknown>) => fn(tx)),
  };

  return { prisma, tx };
}

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let tx: ReturnType<typeof makePrisma>['tx'];
  let meters: MetersService;

  beforeEach(() => {
    ({ prisma, tx } = makePrisma());
    meters = metersStub();
    service = new ExpensesService(
      prisma as unknown as PrismaService,
      auditStub(),
      meters,
    );

    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-1',
      buildingId: 'building-1',
      strategy: AllocationStrategy.MILIMES,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-a', millimes: 600 },
      { id: 'unit-b', millimes: 400 },
    ]);
  });

  const createDto = {
    categoryId: 'cat-1',
    description: 'Clean October',
    totalCents: 1001,
    periodYearMonth: '2026-09',
  };

  it('splits by millimes and persists expense + exact shares in a transaction', async () => {
    await service.create('building-1', createDto, user());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.expenseCategory.findFirst).toHaveBeenCalledWith({
      where: { id: 'cat-1', buildingId: 'building-1' },
    });
    expect(tx.expense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildingId: 'building-1',
        categoryId: 'cat-1',
        totalCents: 1001,
        periodYearMonth: '2026-09',
        createdById: 'admin-1',
      }),
    });

    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares).toEqual(
      expect.arrayContaining([
        { expenseId: 'expense-1', unitId: 'unit-a', amountCents: 601 },
        { expenseId: 'expense-1', unitId: 'unit-b', amountCents: 400 },
      ]),
    );
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
  });

  it('weights every unit equally for UNITS strategy', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-units',
      buildingId: 'building-1',
      strategy: AllocationStrategy.UNITS,
    });

    await service.create(
      'building-1',
      { ...createDto, categoryId: 'cat-units', totalCents: 101 },
      user(),
    );

    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares.map((s) => s.amountCents)).toEqual([51, 50]);
  });

  it('allocates by radiatorCount for RADIATORS and sums exactly to the total', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-heating',
      buildingId: 'building-1',
      strategy: AllocationStrategy.RADIATORS,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-a', millimes: 600, radiatorCount: 3 },
      { id: 'unit-b', millimes: 400, radiatorCount: 2 },
    ]);

    await service.create(
      'building-1',
      { ...createDto, categoryId: 'cat-heating', totalCents: 1001 },
      user(),
    );

    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares).toEqual(
      expect.arrayContaining([
        { expenseId: 'expense-1', unitId: 'unit-a', amountCents: 601 },
        { expenseId: 'expense-1', unitId: 'unit-b', amountCents: 400 },
      ]),
    );
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
  });

  it('rejects RADIATORS when no unit has a radiator', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-heating',
      buildingId: 'building-1',
      strategy: AllocationStrategy.RADIATORS,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-a', millimes: 600, radiatorCount: 0 },
      { id: 'unit-b', millimes: 400, radiatorCount: 0 },
    ]);

    await expect(
      service.create(
        'building-1',
        { ...createDto, categoryId: 'cat-heating' },
        user(),
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'Category strategy requires at least one unit with radiatorCount > 0',
      ),
    );
    expect(tx.expense.create).not.toHaveBeenCalled();
  });

  it('exempts ground-floor units under ELEVATOR_FLOORS and splits by floor', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-elevator',
      buildingId: 'building-1',
      strategy: AllocationStrategy.ELEVATOR_FLOORS,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-ground', millimes: 250, floor: 0 },
      { id: 'unit-basement', millimes: 250, floor: null },
      { id: 'unit-f2', millimes: 250, floor: 2 },
      { id: 'unit-f3', millimes: 250, floor: 3 },
    ]);

    await service.create(
      'building-1',
      { ...createDto, categoryId: 'cat-elevator', totalCents: 1001 },
      user(),
    );

    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares).toEqual(
      expect.arrayContaining([
        { expenseId: 'expense-1', unitId: 'unit-ground', amountCents: 0 },
        { expenseId: 'expense-1', unitId: 'unit-basement', amountCents: 0 },
        { expenseId: 'expense-1', unitId: 'unit-f2', amountCents: 400 },
        { expenseId: 'expense-1', unitId: 'unit-f3', amountCents: 601 },
      ]),
    );
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
  });

  it('splits by meter consumption for METERS and sums exactly to the total', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-meters',
      buildingId: 'building-1',
      strategy: 'METERS' as unknown as AllocationStrategy,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-a', millimes: 600 },
      { id: 'unit-b', millimes: 400 },
    ]);
    (meters.buildUnitConsumptions as jest.Mock).mockResolvedValue([
      { unitId: 'unit-a', unitLabel: 'Α1', consumed: 5000, hasReadings: true },
      { unitId: 'unit-b', unitLabel: 'Β1', consumed: 3000, hasReadings: true },
    ]);

    await service.create(
      'building-1',
      { ...createDto, categoryId: 'cat-meters' },
      user(),
    );

    expect(meters.buildUnitConsumptions).toHaveBeenCalledWith(
      'building-1',
      createDto.periodYearMonth,
    );
    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares).toEqual(
      expect.arrayContaining([
        { expenseId: 'expense-1', unitId: 'unit-a', amountCents: 626 },
        { expenseId: 'expense-1', unitId: 'unit-b', amountCents: 375 },
      ]),
    );
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
  });

  it('rejects METERS when any unit lacks a reading, listing the missing units', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-meters',
      buildingId: 'building-1',
      strategy: 'METERS' as unknown as AllocationStrategy,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-a', millimes: 600 },
      { id: 'unit-b', millimes: 400 },
    ]);
    (meters.buildUnitConsumptions as jest.Mock).mockResolvedValue([
      { unitId: 'unit-a', unitLabel: 'Α1', consumed: 5000, hasReadings: true },
      { unitId: 'unit-b', unitLabel: 'Β1', consumed: 0, hasReadings: false },
    ]);

    await expect(
      service.create(
        'building-1',
        { ...createDto, categoryId: 'cat-meters' },
        user(),
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'METERS strategy requires a reading for every unit; units missing readings: unit-b',
      ),
    );
    expect(tx.expense.create).not.toHaveBeenCalled();
  });

  it('rejects CUSTOM strategy with a clear message', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-custom',
      buildingId: 'building-1',
      strategy: AllocationStrategy.CUSTOM,
    });

    await expect(
      service.create(
        'building-1',
        { ...createDto, categoryId: 'cat-custom' },
        user(),
      ),
    ).rejects.toThrow(
      new BadRequestException('CUSTOM allocation not supported yet'),
    );
  });

  it('splits an expense exactly by square meters across units', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-area',
      buildingId: 'building-1',
      strategy: AllocationStrategy.SQUARE_METERS,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-a', millimes: 500, squareMeters: 85.5 },
      { id: 'unit-b', millimes: 500, squareMeters: 64.25 },
    ]);

    await service.create(
      'building-1',
      { ...createDto, categoryId: 'cat-area', totalCents: 1001 },
      user(),
    );

    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
    // 8550 : 6425 ≈ 0.571 : 0.429 → 572 / 429 cents on 1001.
    const byUnit = new Map(shares.map((s) => [s.unitId, s.amountCents]));
    expect(byUnit.get('unit-a')).toBe(572);
    expect(byUnit.get('unit-b')).toBe(429);
  });

  it('splits an expense exactly by ownership share across units', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-share',
      buildingId: 'building-1',
      strategy: AllocationStrategy.SHARE_FRACTION,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-a', millimes: 500, shareFraction: 600 },
      { id: 'unit-b', millimes: 500, shareFraction: 400 },
    ]);

    await service.create(
      'building-1',
      { ...createDto, categoryId: 'cat-share', totalCents: 1001 },
      user(),
    );

    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(1001);
    const byUnit = new Map(shares.map((s) => [s.unitId, s.amountCents]));
    expect(byUnit.get('unit-a')).toBe(601);
    expect(byUnit.get('unit-b')).toBe(400);
  });

  it('splits an expense equally per unit under HEADCOUNT, ignoring millimes', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue({
      id: 'cat-headcount',
      buildingId: 'building-1',
      strategy: AllocationStrategy.HEADCOUNT,
    });
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-a', millimes: 900, shareFraction: 900 },
      { id: 'unit-b', millimes: 100, shareFraction: 100 },
    ]);

    await service.create(
      'building-1',
      { ...createDto, categoryId: 'cat-headcount', totalCents: 101 },
      user(),
    );

    const shares = tx.share.createMany.mock.calls[0][0].data as Array<{
      unitId: string;
      amountCents: number;
    }>;
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0)).toBe(101);
    const byUnit = new Map(shares.map((s) => [s.unitId, s.amountCents]));
    // Equal split of 101 cents over 2 units → 51 / 50 (largest remainder).
    expect(byUnit.get('unit-a')).toBe(51);
    expect(byUnit.get('unit-b')).toBe(50);
  });

  it('rejects an invalid period before touching the database', async () => {
    await expect(
      service.create(
        'building-1',
        { ...createDto, periodYearMonth: '2026-13' },
        user(),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.expenseCategory.findFirst).not.toHaveBeenCalled();
  });

  it('throws Forbidden when the caller belongs to another building', async () => {
    await expect(
      service.list('building-2', undefined, user({ buildingId: 'building-9' })),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.expense.findMany).not.toHaveBeenCalled();
  });

  it('throws NotFound when the category is missing or foreign', async () => {
    prisma.expenseCategory.findFirst.mockResolvedValue(null);

    await expect(
      service.create('building-1', createDto, user()),
    ).rejects.toThrow(NotFoundException);
  });

  it('filters the list by optional period', async () => {
    await service.list('building-1', '2026-08', user());
    expect(prisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildingId: 'building-1', periodYearMonth: '2026-08' },
      }),
    );
  });
});

describe('resolveAllocationWeights', () => {
  it('maps strategies to integer weights, treating missing floors as exempt', () => {
    const units = [
      { id: 'unit-ground', millimes: 500, floor: 0, radiatorCount: 2 },
      { id: 'unit-top', millimes: 500, floor: 4, radiatorCount: 3 },
    ];

    expect(resolveAllocationWeights(units, AllocationStrategy.MILIMES)).toEqual(
      [
        { id: 'unit-ground', weight: 500 },
        { id: 'unit-top', weight: 500 },
      ],
    );
    expect(resolveAllocationWeights(units, AllocationStrategy.UNITS)).toEqual([
      { id: 'unit-ground', weight: 1 },
      { id: 'unit-top', weight: 1 },
    ]);
    expect(
      resolveAllocationWeights(units, AllocationStrategy.RADIATORS),
    ).toEqual([
      { id: 'unit-ground', weight: 2 },
      { id: 'unit-top', weight: 3 },
    ]);
    expect(
      resolveAllocationWeights(
        [
          { id: 'unit-x', millimes: 100 },
          { id: 'unit-y', millimes: 100, floor: 4 },
        ],
        AllocationStrategy.ELEVATOR_FLOORS,
      ),
    ).toEqual([
      { id: 'unit-x', weight: 0 },
      { id: 'unit-y', weight: 4 },
    ]);
  });

  it('rejects zero-weight allocations for RADIATORS and ELEVATOR_FLOORS only', () => {
    const units = [
      { id: 'unit-a', millimes: 0, floor: 0, radiatorCount: 0 },
      { id: 'unit-b', millimes: 0, floor: -1, radiatorCount: 0 },
    ];

    expect(() =>
      resolveAllocationWeights(units, AllocationStrategy.RADIATORS),
    ).toThrow(
      new BadRequestException(
        'Category strategy requires at least one unit with radiatorCount > 0',
      ),
    );
    expect(() =>
      resolveAllocationWeights(units, AllocationStrategy.ELEVATOR_FLOORS),
    ).toThrow(
      new BadRequestException(
        'Category strategy requires at least one unit with floor >= 1',
      ),
    );
    expect(() =>
      resolveAllocationWeights(units, AllocationStrategy.CUSTOM),
    ).toThrow(new BadRequestException('CUSTOM allocation not supported yet'));
  });

  it('weights SQUARE_METERS by m² scaled to integer hundredths', () => {
    const units = [
      { id: 'unit-a', millimes: 500, squareMeters: 85.5 },
      { id: 'unit-b', millimes: 500, squareMeters: 64.25 },
    ];

    expect(
      resolveAllocationWeights(units, AllocationStrategy.SQUARE_METERS),
    ).toEqual([
      { id: 'unit-a', weight: 8550 },
      { id: 'unit-b', weight: 6425 },
    ]);
  });

  it('weights SHARE_FRACTION by the ‰ ownership share', () => {
    const units = [
      { id: 'unit-a', millimes: 500, shareFraction: 600 },
      { id: 'unit-b', millimes: 500, shareFraction: 400 },
    ];

    expect(
      resolveAllocationWeights(units, AllocationStrategy.SHARE_FRACTION),
    ).toEqual([
      { id: 'unit-a', weight: 600 },
      { id: 'unit-b', weight: 400 },
    ]);
  });

  it('rejects SQUARE_METERS / SHARE_FRACTION when no unit has a weight', () => {
    const units = [
      { id: 'unit-a', millimes: 500, squareMeters: 0, shareFraction: 0 },
      { id: 'unit-b', millimes: 500, squareMeters: null, shareFraction: null },
    ];

    expect(() =>
      resolveAllocationWeights(units, AllocationStrategy.SQUARE_METERS),
    ).toThrow(
      new BadRequestException(
        'Category strategy requires at least one unit with squareMeters > 0',
      ),
    );
    expect(() =>
      resolveAllocationWeights(units, AllocationStrategy.SHARE_FRACTION),
    ).toThrow(
      new BadRequestException(
        'Category strategy requires at least one unit with shareFraction > 0',
      ),
    );
  });

  it('rejects zero-weight allocations for RADIATORS and ELEVATOR_FLOORS only', () => {
    const units = [
      { id: 'unit-a', millimes: 0, floor: 0, radiatorCount: 0 },
      { id: 'unit-b', millimes: 0, floor: -1, radiatorCount: 0 },
    ];

    expect(() =>
      resolveAllocationWeights(units, AllocationStrategy.RADIATORS),
    ).toThrow(
      new BadRequestException(
        'Category strategy requires at least one unit with radiatorCount > 0',
      ),
    );
    expect(() =>
      resolveAllocationWeights(units, AllocationStrategy.ELEVATOR_FLOORS),
    ).toThrow(
      new BadRequestException(
        'Category strategy requires at least one unit with floor >= 1',
      ),
    );
    expect(() =>
      resolveAllocationWeights(units, AllocationStrategy.CUSTOM),
    ).toThrow(new BadRequestException('CUSTOM allocation not supported yet'));
  });

  it('weights HEADCOUNT equally with weight 1 per unit, ignoring millimes', () => {
    const units = [
      { id: 'unit-a', millimes: 900 },
      { id: 'unit-b', millimes: 100 },
      { id: 'unit-c', millimes: 0 },
    ];

    expect(
      resolveAllocationWeights(units, AllocationStrategy.HEADCOUNT),
    ).toEqual([
      { id: 'unit-a', weight: 1 },
      { id: 'unit-b', weight: 1 },
      { id: 'unit-c', weight: 1 },
    ]);
  });
});
