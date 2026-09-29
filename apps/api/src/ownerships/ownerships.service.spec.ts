import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { OwnershipsService } from './ownerships.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId: 'building-1',
  ...overrides,
});

function makePrisma() {
  const prisma = {
    unit: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    ownership: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { shareMillimes: 0 } }),
      create: jest.fn().mockResolvedValue({ id: 'ownership-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { update: prisma.user.update },
        ownership: { create: prisma.ownership.create },
      }),
  );
  return prisma;
}

describe('OwnershipsService', () => {
  let service: OwnershipsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new OwnershipsService(prisma as unknown as PrismaService);
    prisma.unit.findUnique.mockResolvedValue({
      id: 'unit-a',
      buildingId: 'building-1',
      millimes: 300,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      buildingId: 'building-1',
    });
  });

  it('creates an ownership within the unit millimes budget', async () => {
    const result = await service.create(
      'unit-a',
      { userId: 'resident-1', shareMillimes: 250, periodStart: '2026-01-01T00:00:00Z' },
      user(),
    );

    expect(result.id).toBe('ownership-1');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.ownership.create).toHaveBeenCalledWith({
      data: {
        unitId: 'unit-a',
        userId: 'resident-1',
        shareMillimes: 250,
        periodStart: new Date('2026-01-01T00:00:00Z'),
      },
    });
  });

  it('links a building-less resident to the unit’s building', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-2',
      buildingId: null,
    });

    await service.create(
      'unit-a',
      { userId: 'resident-2', shareMillimes: 50 },
      user(),
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'resident-2' },
      data: { buildingId: 'building-1' },
    });
  });

  it('rejects shares exceeding the unit millimes', async () => {
    prisma.ownership.aggregate.mockResolvedValue({ _sum: { shareMillimes: 200 } });

    await expect(
      service.create(
        'unit-a',
        { userId: 'resident-1', shareMillimes: 150 },
        user(),
      ),
    ).rejects.toThrow(/only has 300/);
  });

  it('rejects a target user from another building', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-x',
      buildingId: 'building-9',
    });

    await expect(
      service.create(
        'unit-a',
        { userId: 'resident-x', shareMillimes: 10 },
        user(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects unknown users or units and foreign admins', async () => {
    prisma.unit.findUnique.mockResolvedValue(null);
    await expect(
      service.create('ghost', { userId: 'r', shareMillimes: 1 }, user()),
    ).rejects.toThrow(NotFoundException);

    prisma.unit.findUnique.mockResolvedValue({
      id: 'unit-a',
      buildingId: 'building-1',
      millimes: 100,
    });
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.create('unit-a', { userId: 'ghost', shareMillimes: 1 }, user()),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.create(
        'unit-a',
        { userId: 'resident-1', shareMillimes: 1 },
        user({ buildingId: 'other' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
