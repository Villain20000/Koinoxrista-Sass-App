import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { UnitsService } from './units.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId: 'building-1',
  ...overrides,
});

function makePrisma() {
  return {
    building: { findUnique: jest.fn().mockResolvedValue({ id: 'building-1' }) },
    unit: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { millimes: 0 } }),
    },
    ownership: { findMany: jest.fn(), aggregate: jest.fn() },
    invoice: { findMany: jest.fn() },
  };
}

describe('UnitsService', () => {
  let service: UnitsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new UnitsService(prisma as unknown as PrismaService);
  });

  it('creates a unit when the millimes budget allows it', async () => {
    prisma.unit.aggregate.mockResolvedValue({ _sum: { millimes: 900 } });
    prisma.unit.create.mockResolvedValue({
      id: 'unit-new',
      buildingId: 'building-1',
      label: 'Α7',
      millimes: 100,
    });

    const result = await service.create(
      'building-1',
      { label: 'Α7', floor: 3, millimes: 100 },
      user(),
    );

    expect(result.label).toBe('Α7');
    expect(prisma.unit.aggregate).toHaveBeenCalledWith({
      where: { buildingId: 'building-1' },
      _sum: { millimes: true },
    });
  });

  it('persists radiatorCount on create, defaulting to 0 when omitted', async () => {
    prisma.unit.aggregate.mockResolvedValue({ _sum: { millimes: 900 } });
    prisma.unit.create.mockResolvedValue({
      id: 'unit-new',
      buildingId: 'building-1',
      label: 'Α7',
      millimes: 100,
      radiatorCount: 3,
    });

    await service.create(
      'building-1',
      { label: 'Α7', floor: 3, millimes: 100, radiatorCount: 3 },
      user(),
    );
    await service.create(
      'building-1',
      { label: 'Α8', floor: 4, millimes: 100 },
      user(),
    );

    expect(prisma.unit.create).toHaveBeenNthCalledWith(1, {
      data: {
        buildingId: 'building-1',
        label: 'Α7',
        floor: 3,
        millimes: 100,
        radiatorCount: 3,
      },
    });
    expect(prisma.unit.create).toHaveBeenNthCalledWith(2, {
      data: {
        buildingId: 'building-1',
        label: 'Α8',
        floor: 4,
        millimes: 100,
        radiatorCount: 0,
      },
    });
  });

  it('overrides radiatorCount on update only when provided', async () => {
    prisma.unit.findUnique.mockResolvedValue({
      id: 'unit-a',
      buildingId: 'building-1',
      label: 'Α1',
      millimes: 200,
      radiatorCount: 2,
    });
    prisma.unit.update.mockResolvedValue({ id: 'unit-a', radiatorCount: 5 });

    await service.update(
      'building-1',
      'unit-a',
      { radiatorCount: 5 },
      user(),
    );
    expect(prisma.unit.update).toHaveBeenLastCalledWith({
      where: { id: 'unit-a' },
      data: {
        label: 'Α1',
        floor: undefined,
        millimes: 200,
        radiatorCount: 5,
      },
    });

    await service.update('building-1', 'unit-a', { millimes: 200 }, user());
    const lastCall = prisma.unit.update.mock.calls.at(-1)[0] as {
      data: { radiatorCount: number };
    };
    expect(lastCall.data.radiatorCount).toBe(2);
  });

  it('rejects a unit that would push the total above 1000, reporting the current total', async () => {
    prisma.unit.aggregate.mockResolvedValue({ _sum: { millimes: 950 } });

    await expect(
      service.create('building-1', { label: 'Α8', millimes: 60 }, user()),
    ).rejects.toThrow(/current total is 950/);
    expect(prisma.unit.create).not.toHaveBeenCalled();
  });

  it('excludes the updated unit from the Σ≤1000 check on update', async () => {
    prisma.unit.findUnique.mockResolvedValue({
      id: 'unit-a',
      buildingId: 'building-1',
      label: 'Α1',
      millimes: 200,
    });
    prisma.unit.aggregate.mockResolvedValue({ _sum: { millimes: 850 } });
    prisma.unit.update.mockResolvedValue({ id: 'unit-a', millimes: 150 });

    await service.update(
      'building-1',
      'unit-a',
      { millimes: 150 },
      user(),
    );

    expect(prisma.unit.aggregate).toHaveBeenCalledWith({
      where: { buildingId: 'building-1', id: { not: 'unit-a' } },
      _sum: { millimes: true },
    });
    expect(prisma.unit.update).toHaveBeenCalled();
  });

  it('rejects an update that would exceed the millimes budget', async () => {
    prisma.unit.findUnique.mockResolvedValue({
      id: 'unit-a',
      buildingId: 'building-1',
      label: 'Α1',
      millimes: 200,
    });
    prisma.unit.aggregate.mockResolvedValue({ _sum: { millimes: 900 } });

    await expect(
      service.update('building-1', 'unit-a', { millimes: 250 }, user()),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.unit.update).not.toHaveBeenCalled();
  });

  it('blocks deletion when the unit has shares or invoices', async () => {
    prisma.unit.findUnique.mockResolvedValue({
      id: 'unit-a',
      buildingId: 'building-1',
      _count: { shares: 2, invoices: 0 },
    });

    await expect(service.remove('building-1', 'unit-a', user())).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.unit.delete).not.toHaveBeenCalled();
  });

  it('deletes cleanly when the unit has no dependencies', async () => {
    prisma.unit.findUnique.mockResolvedValue({
      id: 'unit-a',
      buildingId: 'building-1',
      _count: { shares: 0, invoices: 0 },
    });

    await service.remove('building-1', 'unit-a', user());

    expect(prisma.unit.delete).toHaveBeenCalledWith({ where: { id: 'unit-a' } });
  });

  it('enforces tenant scope on reads and writes', async () => {
    await expect(
      service.listForBuilding('building-2', user()),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.create('building-2', { label: 'X', millimes: 10 }, user()),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.unit.aggregate).not.toHaveBeenCalled();
  });
});
