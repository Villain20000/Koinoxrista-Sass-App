import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { buildInviteUrl, hashInviteToken, InvitesService } from './invites.service';
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
    unit: { findFirst: jest.fn() },
    invite: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    ownership: { findFirst: jest.fn().mockResolvedValue(null) },
    membership: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

describe('InvitesService', () => {
  let service: InvitesService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    delete process.env.APP_URL;
    prisma = makePrisma();
    service = new InvitesService(prisma as unknown as PrismaService);
  });

  describe('list', () => {
    it('returns the building invites newest first with unit label', async () => {
      const rows = [
        { id: 'i2', createdAt: new Date('2026-02-01T00:00:00Z'), unit: null },
      ];
      prisma.invite.findMany.mockResolvedValue(rows);

      const result = await service.list('building-1', user());

      expect(result).toEqual(rows);
      expect(prisma.invite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buildingId: 'building-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('rejects access to another building', async () => {
      await expect(service.list('building-2', user())).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.invite.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    const base = { email: 'Nikos@demo.gr', role: 'RESIDENT' } as const;

    it('creates a RESIDENT invite with hashed token and default 14-day expiry', async () => {
      prisma.unit.findFirst.mockResolvedValue({ id: 'unit-1', buildingId: 'building-1' });
      prisma.invite.create.mockImplementation(async ({ data }) => ({
        id: 'i1',
        ...data,
        unit: { label: 'Α1' },
      }));

      const result = await service.create('building-1', { ...base, unitId: 'unit-1' }, user());

      const data = prisma.invite.create.mock.calls[0][0].data;
      expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(data.buildingId).toBe('building-1');
      expect(data.unitId).toBe('unit-1');
      expect(data.invitedById).toBe('admin-1');
      const days = (data.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThanOrEqual(13.99);
      expect(days).toBeLessThanOrEqual(14.01);

      const raw = result.inviteUrl.split('invite=')[1];
      expect(raw).toMatch(/^[a-f0-9]{64}$/);
      expect(hashInviteToken(raw)).toBe(data.tokenHash);
      expect(result.inviteUrl).toBe(buildInviteUrl(raw));
    });

    it('honours expiresInDays and APP_URL for the generated link', async () => {
      process.env.APP_URL = 'https://poly.example.gr';
      prisma.unit.findFirst.mockResolvedValue({ id: 'unit-1', buildingId: 'building-1' });
      prisma.invite.create.mockImplementation(async ({ data }) => ({ id: 'i1', ...data }));

      const before = Date.now();
      const result = await service.create(
        'building-1',
        { email: 'x@demo.gr', role: 'ADMIN', expiresInDays: 30 },
        user(),
      );

      const data = prisma.invite.create.mock.calls[0][0].data;
      expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
      expect(result.inviteUrl.startsWith('https://poly.example.gr/register?invite=')).toBe(true);
    });

    it('requires a unit of the building for RESIDENT invites (400 without, 404 otherwise)', async () => {
      await expect(
        service.create('building-1', { ...base }, user()),
      ).rejects.toMatchObject({ status: 400 });

      prisma.unit.findFirst.mockResolvedValue(null);
      await expect(
        service.create('building-1', { ...base, unitId: 'other-unit' }, user()),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.unit.findFirst).toHaveBeenCalledWith({
        where: { id: 'other-unit', buildingId: 'building-1' },
      });
    });

    it('rejects a pending duplicate email in the same building (409)', async () => {
      prisma.invite.findFirst.mockResolvedValue({ id: 'pending-1' });

      await expect(
        service.create('building-1', { email: 'a@demo.gr', role: 'ADMIN' }, user()),
      ).rejects.toMatchObject({ status: 409, message: 'An active invite already exists for this email' });
      expect(prisma.invite.create).not.toHaveBeenCalled();
    });

    it('allows re-inviting after acceptance or expiry (only pending duplicates block)', async () => {
      prisma.invite.findFirst.mockResolvedValue(null);
      prisma.invite.create.mockImplementation(async ({ data }) => ({ id: 'i1', ...data }));

      await expect(
        service.create('building-1', { email: 'a@demo.gr', role: 'PROVIDER' }, user()),
      ).resolves.toMatchObject({ inviteUrl: expect.stringContaining('/register?invite=') });
    });

    it('conflicts when the invited user already has an ownership on the unit (RESIDENT)', async () => {
      prisma.unit.findFirst.mockResolvedValue({ id: 'unit-1', buildingId: 'building-1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-exists' });
      prisma.ownership.findFirst.mockResolvedValue({ id: 'o1' });

      await expect(
        service.create('building-1', { ...base, unitId: 'unit-1' }, user()),
      ).rejects.toMatchObject({ status: 409, message: 'User already belongs to this building' });
    });

    it('conflicts when the invited admin already has a membership in the building', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-exists' });
      prisma.membership.findFirst.mockResolvedValue({ id: 'm1' });

      await expect(
        service.create('building-1', { email: 'a@demo.gr', role: 'ADMIN' }, user()),
      ).rejects.toThrow(ConflictException);
      expect(prisma.ownership.findFirst).not.toHaveBeenCalled();
    });

    it('lowercases the stored email', async () => {
      prisma.invite.create.mockImplementation(async ({ data }) => ({ id: 'i1', ...data }));

      await service.create('building-1', { email: 'Mixed@Demo.GR', role: 'ADMIN' }, user());

      expect(prisma.invite.create.mock.calls[0][0].data.email).toBe('mixed@demo.gr');
    });
  });

  describe('revoke', () => {
    it('deletes an invite of the caller building', async () => {
      prisma.invite.findUnique.mockResolvedValue({ id: 'i1', buildingId: 'building-1' });

      await service.revoke('i1', user());

      expect(prisma.invite.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });
    });

    it('hides invites belonging to another building (404)', async () => {
      prisma.invite.findUnique.mockResolvedValue({ id: 'i1', buildingId: 'building-2' });

      await expect(service.revoke('i1', user())).rejects.toThrow(NotFoundException);
      expect(prisma.invite.delete).not.toHaveBeenCalled();
    });
  });
});
