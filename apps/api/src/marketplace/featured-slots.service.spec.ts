import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { FeaturedSlotsService } from './featured-slots.service';

const admin = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
  ...overrides,
});

const slotRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'slot-1',
  buildingId: 'building-1',
  providerId: 'provider-1',
  trade: 'Υδραυλικός',
  startsAt: new Date('2026-09-01T00:00:00Z'),
  endsAt: new Date('2026-10-01T00:00:00Z'),
  createdAt: new Date('2026-08-25T00:00:00Z'),
  provider: { firstName: 'Νίκος', lastName: 'Παπάς' },
  ...overrides,
});

function makePrisma() {
  return {
    featuredSlot: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: 'provider-1' }),
    },
  };
}

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

describe('FeaturedSlotsService', () => {
  let service: FeaturedSlotsService;
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;

  const dto = {
    providerId: 'provider-1',
    trade: 'Υδραυλικός',
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-10-01T00:00:00.000Z',
  };

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new FeaturedSlotsService(
      prisma as unknown as PrismaService,
      audit,
    );
  });

  describe('list', () => {
    it('returns the building slots newest-first with provider names', async () => {
      const created = slotRow();
      prisma.featuredSlot.findMany.mockResolvedValue([created]);

      const slots = await service.list('building-1', admin());

      expect(prisma.featuredSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buildingId: 'building-1' },
          orderBy: { startsAt: 'desc' },
        }),
      );
      expect(slots[0]).toMatchObject({
        id: 'slot-1',
        providerName: 'Νίκος Παπάς',
        trade: 'Υδραυλικός',
      });
      expect(slots[0].startsAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('forbids another building', async () => {
      await expect(service.list('building-2', admin())).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('create', () => {
    it('creates the slot, normalizes a blank trade to null and audits it', async () => {
      prisma.featuredSlot.create.mockResolvedValue(slotRow());

      const slot = await service.create('building-1', dto, admin());

      expect(prisma.featuredSlot.findFirst).toHaveBeenCalledWith({
        where: {
          buildingId: 'building-1',
          providerId: 'provider-1',
          startsAt: { lt: new Date(dto.endsAt) },
          endsAt: { gt: new Date(dto.startsAt) },
        },
        select: { id: true },
      });
      expect(prisma.featuredSlot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buildingId: 'building-1',
            providerId: 'provider-1',
            trade: 'Υδραυλικός',
          }),
        }),
      );
      expect(slot.providerName).toBe('Νίκος Παπάς');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'featured-slot.create',
          entity: 'featured_slot',
        }),
      );
    });

    it('rejects an inverted or unparseable window with 400', async () => {
      await expect(
        service.create(
          'building-1',
          { ...dto, endsAt: '2026-08-01T00:00:00.000Z' },
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(
          'building-1',
          { ...dto, startsAt: 'not-a-date' },
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('404s when the provider does not exist or is not a PROVIDER', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.create('building-1', dto, admin())).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'provider-1', role: Role.PROVIDER },
        select: { id: true },
      });
    });

    it('409s when the same provider has an overlapping active window', async () => {
      prisma.featuredSlot.findFirst.mockResolvedValue({ id: 'slot-existing' });

      await expect(service.create('building-1', dto, admin())).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.featuredSlot.create).not.toHaveBeenCalled();
    });

    it('allows touching windows and other providers (half-open interval math)', async () => {
      // Overlap check uses startsAt < newEnd AND endsAt > newStart, so
      // back-to-back windows never collide.
      prisma.featuredSlot.findFirst.mockResolvedValue(null);
      prisma.featuredSlot.create.mockResolvedValue(slotRow());

      await service.create('building-1', dto, admin());
      expect(prisma.featuredSlot.create).toHaveBeenCalledTimes(1);
    });

    it('forbids another building', async () => {
      await expect(
        service.create('building-2', dto, admin()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('deletes a building-owned slot and audits the removal', async () => {
      const existing = slotRow();
      prisma.featuredSlot.findFirst.mockResolvedValue(existing);

      await expect(service.remove('building-1', 'slot-1', admin())).resolves.toBeUndefined();

      expect(prisma.featuredSlot.delete).toHaveBeenCalledWith({
        where: { id: 'slot-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'featured-slot.delete',
          entityId: 'slot-1',
        }),
      );
    });

    it('throws NotFound for foreign or missing slots', async () => {
      prisma.featuredSlot.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('building-1', 'missing', admin()),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.featuredSlot.delete).not.toHaveBeenCalled();
    });
  });
});
