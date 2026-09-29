import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { COMPLIANCE_EXPIRING_TYPE, ComplianceService, daysLeftOf } from './compliance.service';

const NOW = new Date('2026-08-25T10:00:00.000Z');

const user = { id: 'admin-1', email: 'a@b.gr', role: Role.ADMIN, buildingId: 'building-1' };

const complianceItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  buildingId: 'building-1',
  kind: 'INSURANCE',
  title: 'Ασφάλιση κτιρίου 2026',
  providerName: 'ΑΣΦΑΛΙΣΤΙΚΗ',
  policyNumber: 'POL-100',
  premiumCents: 12_000,
  startsOn: new Date('2026-01-01T00:00:00.000Z'),
  endsOn: new Date('2026-09-15T00:00:00.000Z'),
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

function makePrisma() {
  return {
    complianceItem: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('daysLeftOf', () => {
  it.each([
    ['2026-08-25', '2026-08-25', 0],
    ['2026-08-25', '2026-08-26', 1],
    ['2026-08-25', '2026-09-15', 21],
    ['2026-08-25', '2026-08-18', -7],
    ['2026-12-31', '2027-01-01', 1],
  ])('endsOn %s from %s is %i days', (_now, endsOn, expected) => {
    expect(daysLeftOf(new Date(endsOn), new Date(_now))).toBe(expected);
  });
});

describe('ComplianceService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { record: jest.Mock };
  let notifications: { create: jest.Mock };
  let service: ComplianceService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = makePrisma();
    audit = { record: jest.fn() };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };
    service = new ComplianceService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('list', () => {
    it('maps items ordered by endsOn asc with computed expired/daysLeft', async () => {
      prisma.complianceItem.findMany.mockResolvedValue([
        complianceItem(),
        complianceItem({
          id: 'item-2',
          kind: 'ELEVATOR_CERTIFICATE',
          title: 'Πιστοποιητικό ανελκυστήρα',
          endsOn: new Date('2026-08-01T00:00:00.000Z'),
          providerName: null,
          policyNumber: null,
          premiumCents: null,
        }),
      ]);

      const result = await service.list('building-1', user);

      expect(result[0]).toMatchObject({ id: 'item-1', expired: false, daysLeft: 21 });
      expect(result[1]).toMatchObject({ id: 'item-2', expired: true, daysLeft: -24 });
      expect(result[1].startsOn).toBe('2026-01-01T00:00:00.000Z');
      expect(prisma.complianceItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buildingId: 'building-1' },
          orderBy: { endsOn: 'asc' },
        }),
      );
    });

    it('filters by kind and upcomingDays window', async () => {
      await service.list('building-1', user, { kind: 'INSURANCE', upcomingDays: '30' });

      expect(prisma.complianceItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            buildingId: 'building-1',
            kind: 'INSURANCE',
            endsOn: { lte: new Date('2026-09-24T10:00:00.000Z') },
          },
        }),
      );
    });

    it('rejects a foreign building, invalid kind and bad upcomingDays', async () => {
      await expect(service.list('building-9', user)).rejects.toThrow(ForbiddenException);
      await expect(
        service.list('building-1', user, { kind: 'NOT_A_KIND' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.list('building-1', user, { upcomingDays: '-5' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.list('building-1', user, { upcomingDays: 'soon' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create', () => {
    const dto = {
      kind: 'INSURANCE' as const,
      title: 'Ασφάλιση κτιρίου 2027',
      premiumCents: 15_000,
      startsOn: '2027-01-01T00:00:00.000Z',
      endsOn: '2027-12-31T00:00:00.000Z',
    };

    it('creates the item with tenancy, optional fields and an audit entry', async () => {
      const created = complianceItem({
        id: 'new-item',
        title: dto.title,
        premiumCents: dto.premiumCents,
        startsOn: new Date(dto.startsOn),
        endsOn: new Date(dto.endsOn),
        providerName: undefined,
        policyNumber: undefined,
      });
      prisma.complianceItem.create.mockResolvedValue(created);

      const result = await service.create('building-1', dto, user);

      expect(result).toMatchObject({ id: 'new-item', expired: false });
      expect(prisma.complianceItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          kind: 'INSURANCE',
          title: dto.title,
          startsOn: new Date(dto.startsOn),
          endsOn: new Date(dto.endsOn),
          premiumCents: 15_000,
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'compliance.created', entity: 'compliance_item' }),
      );
    });

    it('rejects endsOn not after startsOn', async () => {
      await expect(
        service.create(
          'building-1',
          { ...dto, endsOn: '2026-12-31T00:00:00.000Z' },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(service.create('building-9', dto, user)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('partially updates an owned item and validates merged date order', async () => {
      prisma.complianceItem.findFirst.mockResolvedValue(complianceItem());
      prisma.complianceItem.update.mockResolvedValue(
        complianceItem({ endsOn: new Date('2027-06-30T00:00:00.000Z') }),
      );

      await service.update('item-1', { endsOn: '2027-06-30T00:00:00.000Z' }, user);

      expect(prisma.complianceItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { endsOn: new Date('2027-06-30T00:00:00.000Z') },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'compliance.updated' }),
      );

      // Merged view: moving startsOn past the stored endsOn must fail.
      await expect(
        service.update('item-1', { startsOn: '2027-12-31T00:00:00.000Z' }, user),
      ).rejects.toThrow(BadRequestException);
    });

    it('hides items of other buildings behind a 404', async () => {
      prisma.complianceItem.findFirst.mockResolvedValue(null);
      await expect(service.update('item-x', { title: 'Νέος τίτλος' }, user)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove('item-x', user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes an owned item and audits it', async () => {
      prisma.complianceItem.findFirst.mockResolvedValue(complianceItem());

      await service.remove('item-1', user);

      expect(prisma.complianceItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'compliance.deleted' }),
      );
    });
  });

  describe('checkExpiries', () => {
    const soon = complianceItem({
      id: 'item-soon',
      title: 'Άδεια πυρασφάλειας',
      endsOn: new Date('2026-08-30T00:00:00.000Z'),
    });
    const later = complianceItem({
      id: 'item-later',
      title: 'Πιστοποιητικό ανελκυστήρα',
      kind: 'ELEVATOR_CERTIFICATE',
      endsOn: new Date('2026-09-14T00:00:00.000Z'),
    });

    it('notifies every admin per expiring item and reports the count', async () => {
      prisma.complianceItem.findMany.mockResolvedValue([soon, later]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

      await expect(service.checkExpiries('building-1', user)).resolves.toEqual({
        notified: 4,
        skipped: 0,
      });

      expect(notifications.create).toHaveBeenCalledTimes(4);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          type: COMPLIANCE_EXPIRING_TYPE,
          title: 'Άδεια πυρασφάλειας: λήξη σε 5 ημέρες',
          linkPath: '/admin/compliance',
        }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-2',
          title: 'Πιστοποιητικό ανελκυστήρα: λήξη σε 20 ημέρες',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'compliance.expiry_check' }),
      );
    });

    it('skips pairs already covered by an unread notification within 7 days', async () => {
      prisma.complianceItem.findMany.mockResolvedValue([soon, later]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      prisma.notification.findMany.mockResolvedValue([
        { userId: 'admin-1', body: 'Άδεια πυρασφάλειας — λήξη σε 5 ημέρες' },
      ]);

      await expect(service.checkExpiries('building-1', user)).resolves.toEqual({
        notified: 1,
        skipped: 1,
      });
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({ userId: 'admin-1', title: expect.stringContaining('ανελκυστήρα') }),
      );
      const where = prisma.notification.findMany.mock.calls[0][0].where;
      expect(where.readAt).toBeNull();
      expect(where.type).toBe(COMPLIANCE_EXPIRING_TYPE);
      expect(where.createdAt.gte.getTime()).toBe(NOW.getTime() - 7 * 86_400_000);
    });

    it('returns zeros when nothing expires or no admins exist', async () => {
      await expect(service.checkExpiries('building-1', user)).resolves.toEqual({
        notified: 0,
        skipped: 0,
      });
      expect(prisma.user.findMany).not.toHaveBeenCalled();

      prisma.complianceItem.findMany.mockResolvedValue([soon]);
      await expect(service.checkExpiries('building-1', user)).resolves.toEqual({
        notified: 0,
        skipped: 0,
      });
      expect(notifications.create).not.toHaveBeenCalled();

      await expect(service.checkExpiries('building-9', user)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
