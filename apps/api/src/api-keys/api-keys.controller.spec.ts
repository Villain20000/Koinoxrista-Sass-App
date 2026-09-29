import { Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const admin = (buildingId: string | null = 'building-1'): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: Role.ADMIN,
  buildingId,
});

describe('ApiKeysController', () => {
  let prisma: {
    apiKey: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let controller: ApiKeysController;

  beforeEach(() => {
    prisma = {
      apiKey: {
        create: jest.fn().mockResolvedValue({
          id: 'key-1',
          name: 'CI key',
          prefix: 'abcd1234',
          scopes: ['invoices:read'],
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date('2026-08-24T00:00:00.000Z'),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const service = new ApiKeysService(prisma as unknown as PrismaService);
    controller = new ApiKeysController(service);
  });

  it('creates a key for the admin active building and returns the raw key once', async () => {
    const created = await controller.create(
      { name: 'CI key', scopes: ['invoices:read'] },
      admin(),
    );

    expect(prisma.apiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildingId: 'building-1',
        userId: 'admin-1',
        scopes: ['invoices:read'],
      }),
    });
    expect(created.key).toMatch(/^pk_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/);
  });

  it('lists only the caller building keys (tenant isolation)', async () => {
    await controller.list(admin('building-2'));

    expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildingId: 'building-2' } }),
    );
  });

  it('revokes within the caller building only', async () => {
    prisma.apiKey.findFirst.mockResolvedValue({
      id: 'key-1',
      buildingId: 'building-1',
      name: 'CI key',
      prefix: 'abcd1234',
      scopes: ['invoices:read'],
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    prisma.apiKey.update.mockResolvedValue({
      id: 'key-1',
      name: 'CI key',
      prefix: 'abcd1234',
      scopes: ['invoices:read'],
      lastUsedAt: null,
      revokedAt: new Date('2026-08-24T00:00:00.000Z'),
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    await controller.revoke('key-1', admin('building-1'));

    expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
      where: { id: 'key-1', buildingId: 'building-1' },
    });
  });
});
