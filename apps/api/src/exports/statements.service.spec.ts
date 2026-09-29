import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { ArrearsService } from '../payments/arrears.service';
import { ExportsService } from './exports.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const admin = (): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
});

const resident = (): AuthenticatedUser => ({
  id: 'resident-1',
  email: 'maria@demo.gr',
  role: 'RESIDENT',
  buildingId: 'building-1',
});

function makePrisma() {
  return {
    building: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Ηλέκτρα' }),
    },
    unit: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'u-a', label: 'Α1' }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'u-a', label: 'Α1', buildingId: 'building-1' },
      ]),
    },
    expense: {
      findMany: jest.fn().mockResolvedValue([
        {
          description: 'Αντλία θερμότητας',
          periodYearMonth: '2026-01',
          shares: [
            { unitId: 'u-a', amountCents: 6_000 },
            { unitId: 'u-b', amountCents: 4_000 },
          ],
        },
        {
          description: 'Καθαριότητα',
          periodYearMonth: '2026-02',
          shares: [{ unitId: 'u-a', amountCents: 2_500 }],
        },
      ]),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([
        { unitId: 'u-a', periodYearMonth: '2026-01', paidCents: 4_000 },
        { unitId: 'u-a', periodYearMonth: '2026-01', paidCents: 1_000 },
      ]),
    },
    ownership: {
      findMany: jest.fn().mockResolvedValue([
        { user: { firstName: 'Μαρία', lastName: 'Παπαδοπούλου' } },
      ]),
    },
  };
}

describe('ExportsService.unitStatement', () => {
  let service: ExportsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ExportsService(
      prisma as unknown as PrismaService,
      new ArrearsService(prisma as unknown as PrismaService),
    );
  });

  it('builds rows per (period, description) with payments allocated in order and exact totals', async () => {
    const statement = await service.unitStatement(
      'building-1',
      'u-a',
      '2026',
      admin(),
    );

    expect(statement.buildingName).toBe('Ηλέκτρα');
    expect(statement.unitLabel).toBe('Α1');
    expect(statement.ownerName).toBe('Μαρία Παπαδοπούλου');
    expect(statement.year).toBe('2026');
    expect(statement.rows).toEqual([
      {
        periodYearMonth: '2026-01',
        description: 'Αντλία θερμότητας',
        invoicedCents: 6_000,
        paidCents: 5_000,
      },
      {
        periodYearMonth: '2026-02',
        description: 'Καθαριότητα',
        invoicedCents: 2_500,
        paidCents: 0,
      },
    ]);
    expect(statement.totals).toEqual({
      invoicedCents: 8_500,
      paidCents: 5_000,
      balanceCents: 3_500,
    });
  });

  it('scopes queries to the year and the building/unit', async () => {
    await service.unitStatement('building-1', 'u-a', '2026', admin());

    expect(prisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          buildingId: 'building-1',
          periodYearMonth: { startsWith: '2026-' },
        },
      }),
    );
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          buildingId: 'building-1',
          unitId: 'u-a',
          periodYearMonth: { startsWith: '2026-' },
        },
      }),
    );
    expect(prisma.ownership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { unitId: 'u-a' } }),
    );
  });

  it('returns empty rows with zero totals when the year has no data', async () => {
    prisma.expense.findMany.mockResolvedValue([]);
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.ownership.findMany.mockResolvedValue([]);

    const statement = await service.unitStatement(
      'building-1',
      'u-a',
      '2026',
      admin(),
    );

    expect(statement.rows).toEqual([]);
    expect(statement.totals).toEqual({
      invoicedCents: 0,
      paidCents: 0,
      balanceCents: 0,
    });
    expect(statement.ownerName).toBeUndefined();
  });

  it('rejects a malformed year with 400', async () => {
    await expect(
      service.unitStatement('building-1', 'u-a', '26-01', admin()),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces tenant scope on the building', async () => {
    await expect(
      service.unitStatement('building-2', 'u-a', '2026', admin()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a unit outside the building with 404', async () => {
    prisma.unit.findFirst.mockResolvedValue(null);

    await expect(
      service.unitStatement('building-1', 'u-zzz', '2026', admin()),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ExportsService.myUnitStatement', () => {
  let service: ExportsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ExportsService(
      prisma as unknown as PrismaService,
      new ArrearsService(prisma as unknown as PrismaService),
    );
  });

  it('resolves the caller-owned unit through ownerships like invoices/mine', async () => {
    const statement = await service.myUnitStatement('2026', resident());

    expect(prisma.unit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerships: { some: { userId: 'resident-1' } } },
      }),
    );
    expect(statement.buildingName).toBe('Ηλέκτρα');
    expect(statement.totals.invoicedCents).toBe(8_500);
  });

  it('forbids a resident who owns no units', async () => {
    prisma.unit.findMany.mockResolvedValue([]);

    await expect(service.myUnitStatement('2026', resident())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects a malformed year with 400', async () => {
    await expect(service.myUnitStatement('abcd', resident())).rejects.toThrow(
      BadRequestException,
    );
  });
});
