import { ConflictException, ForbiddenException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { BuildingsService } from './buildings.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId: null,
  ...overrides,
});

function makePrisma() {
  const prisma = {
    building: {
      create: jest.fn().mockResolvedValue({ id: 'building-1', name: 'X' }),
      findUnique: jest.fn(),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        building: { create: prisma.building.create },
        user: { update: prisma.user.update },
      }),
  );
  return prisma;
}

describe('BuildingsService', () => {
  let service: BuildingsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new BuildingsService(prisma as unknown as PrismaService);
  });

  it('creates a building and links the creator in one transaction', async () => {
    await service.create({ name: 'Χτίριο Α', address: 'Εγνατία 12' }, user());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.building.create).toHaveBeenCalledWith({
      data: { name: 'Χτίριο Α', address: 'Εγνατία 12', city: 'Thessaloniki' },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: { buildingId: 'building-1' },
    });
  });

  it('refuses to create a second building for an admin already linked', async () => {
    await expect(
      service.create({ name: 'Δεύτερο' }, user({ buildingId: 'building-1' })),
    ).rejects.toThrow(ConflictException);
  });

  it('returns the own building with units', async () => {
    prisma.building.findUnique.mockResolvedValue({ id: 'building-1', units: [] });

    const result = await service.findMine(user({ buildingId: 'building-1' }));

    expect(result.id).toBe('building-1');
    expect(prisma.building.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'building-1' } }),
    );
  });

  it('refuses users without a building link', async () => {
    await expect(service.findMine(user())).rejects.toThrow(ForbiddenException);
  });
});
