import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';

function makePrisma() {
  return {
    apiKey: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('ApiKeysService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ApiKeysService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ApiKeysService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('returns the raw key exactly once and stores its sha256 hash', async () => {
      prisma.apiKey.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'key-1',
          buildingId: data.buildingId,
          userId: data.userId,
          name: data.name,
          prefix: data.prefix,
          scopes: data.scopes,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date('2026-08-24T00:00:00.000Z'),
        }),
      );

      const created = await service.create('building-1', 'admin-1', {
        name: 'CI key',
        scopes: ['invoices:read'],
      });

      expect(created.key).toMatch(/^pk_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{43}$/);
      expect(created).not.toHaveProperty('keyHash');
      expect(created.prefix).toBe(created.key.split('_')[1]);

      const dataArg = prisma.apiKey.create.mock.calls[0][0].data;
      expect(dataArg.prefix).toHaveLength(8);
      expect(dataArg.keyHash).toBe(
        createHash('sha256').update(created.key, 'utf8').digest('hex'),
      );
      expect(dataArg.scopes).toEqual(['invoices:read']);
    });

    it('rejects users without an active building', async () => {
      await expect(
        service.create(null, 'admin-1', { name: 'x', scopes: ['invoices:read'] }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.apiKey.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('scopes to the caller building and never exposes hashes', async () => {
      prisma.apiKey.findMany.mockResolvedValue([
        {
          id: 'key-1',
          name: 'CI key',
          prefix: 'abcd1234',
          scopes: ['invoices:read'],
          keyHash: 'secret-hash',
          lastUsedAt: new Date('2026-08-01T00:00:00.000Z'),
          revokedAt: null,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);

      const keys = await service.list('building-1');

      expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
        where: { buildingId: 'building-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toHaveProperty('keyHash');
      expect(keys[0]).toMatchObject({ id: 'key-1', prefix: 'abcd1234' });
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on a key of the same building', async () => {
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

      const view = await service.revoke('building-1', 'key-1');

      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith({
        where: { id: 'key-1', buildingId: 'building-1' },
      });
      expect(view.revokedAt).not.toBeNull();
    });

    it('hides keys belonging to another building (tenant isolation)', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(service.revoke('building-2', 'key-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });
  });
});
