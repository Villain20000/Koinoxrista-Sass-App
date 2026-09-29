import { ForbiddenException } from '@nestjs/common';
import { Membership, Role } from '@prisma/client';

import { MembershipsService } from './memberships.service';
import { PrismaService } from '../prisma/prisma.service';

const makeMembershipRow = (
  overrides: Partial<Membership> = {},
): Membership => ({
  id: 'm1',
  userId: 'user-1',
  buildingId: 'building-1',
  role: Role.ADMIN,
  isDefault: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('MembershipsService', () => {
  let service: MembershipsService;
  let prisma: {
    membership: { findMany: jest.Mock; findUnique: jest.Mock };
    user: { update: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      membership: { findMany: jest.fn(), findUnique: jest.fn() },
      user: { update: jest.fn() },
    };
    service = new MembershipsService(prisma as unknown as PrismaService);
  });

  describe('listForUser', () => {
    it('returns memberships with building info, ordered by building name', async () => {
      const rows = [
        {
          id: 'm2',
          role: Role.ADMIN,
          isDefault: false,
          building: {
            id: 'building-2',
            name: 'B Building',
            address: 'Odos 2',
            city: 'Thessaloniki',
          },
        },
        {
          id: 'm1',
          role: Role.RESIDENT,
          isDefault: true,
          building: {
            id: 'building-1',
            name: 'A Building',
            address: 'Odos 1',
            city: 'Thessaloniki',
          },
        },
      ];
      prisma.membership.findMany.mockResolvedValue(rows);

      const result = await service.listForUser('user-1');

      expect(result).toEqual([
        {
          id: 'm2',
          role: Role.ADMIN,
          isDefault: false,
          building: {
            id: 'building-2',
            name: 'B Building',
            address: 'Odos 2',
            city: 'Thessaloniki',
          },
        },
        {
          id: 'm1',
          role: Role.RESIDENT,
          isDefault: true,
          building: {
            id: 'building-1',
            name: 'A Building',
            address: 'Odos 1',
            city: 'Thessaloniki',
          },
        },
      ]);
      expect(prisma.membership.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { building: { name: 'asc' } },
        select: {
          id: true,
          role: true,
          isDefault: true,
          building: {
            select: {
              id: true,
              name: true,
              address: true,
              city: true,
              market: true,
              currency: true,
              pspProvider: true,
            },
          },
        },
      });
    });

    it('returns an empty list for a user without memberships', async () => {
      prisma.membership.findMany.mockResolvedValue([]);
      await expect(service.listForUser('user-x')).resolves.toEqual([]);
    });
  });

  describe('requireMembership', () => {
    it('returns the membership row when it exists', async () => {
      const row = makeMembershipRow({ buildingId: 'building-2' });
      prisma.membership.findUnique.mockResolvedValue(row);

      const result = await service.requireMembership('user-1', 'building-2');

      expect(result).toEqual(row);
      expect(prisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_buildingId: { userId: 'user-1', buildingId: 'building-2' } },
      });
    });

    it('throws 403 "Not a member of this building" when absent', async () => {
      prisma.membership.findUnique.mockResolvedValue(null);

      await expect(
        service.requireMembership('user-1', 'building-9'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.requireMembership('user-1', 'building-9'),
      ).rejects.toMatchObject({
        status: 403,
        message: 'Not a member of this building',
      });
    });
  });

  describe('activateBuilding', () => {
    it('updates the user active building pointer', async () => {
      const updated = { id: 'user-1', buildingId: 'building-2' };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.activateBuilding('user-1', 'building-2');

      expect(result).toEqual(updated);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { buildingId: 'building-2' },
      });
    });
  });
});
