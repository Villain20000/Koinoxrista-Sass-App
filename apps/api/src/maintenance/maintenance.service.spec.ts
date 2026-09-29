import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MaintenanceService, addMonths, daysUntilDue } from './maintenance.service';

const NOW = new Date('2026-08-25T10:00:00.000Z');
const user = { id: 'admin-1', email: 'a@b.gr', role: Role.ADMIN, buildingId: 'building-1' } as any;
const foreignUser = { id: 'admin-9', email: 'x@b.gr', role: Role.ADMIN, buildingId: 'building-9' } as any;

const asset = (overrides: Record<string, unknown> = {}) => ({
  id: 'asset-1',
  buildingId: 'building-1',
  name: 'Ανελκυστήρας κεντρικός',
  category: 'ELEVATOR',
  location: 'Ισόγειο',
  installedAt: new Date('2020-01-01T00:00:00.000Z'),
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const schedule = (overrides: Record<string, unknown> = {}) => ({
  id: 'sched-1',
  assetId: 'asset-1',
  buildingId: 'building-1',
  title: 'Συντήρηση ανελκυστήρα',
  intervalMonths: 6,
  lastDoneAt: new Date('2026-02-25T10:00:00.000Z'),
  nextDueAt: new Date('2026-08-25T10:00:00.000Z'),
  autoCreateJob: true,
  expenseCategoryId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  asset: { id: 'asset-1', name: 'Ανελκυστήρας κεντρικός', category: 'ELEVATOR' },
  ...overrides,
});

function makePrisma() {
  return {
    buildingAsset: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    maintenanceSchedule: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
    },
    job: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'job-1' }),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    expenseCategory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cat-1', buildingId: 'building-1' }),
    },
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('helpers', () => {
  it('daysUntilDue computes UTC days correctly', () => {
    expect(daysUntilDue(new Date('2026-08-25'), new Date('2026-08-25'))).toBe(0);
    expect(daysUntilDue(new Date('2026-08-26'), new Date('2026-08-25'))).toBe(1);
    expect(daysUntilDue(new Date('2026-08-18'), new Date('2026-08-25'))).toBe(-7);
  });

  it('addMonths handles year rollover', () => {
    const d = new Date(Date.UTC(2026, 0, 15, 10, 0, 0)); // Jan 15
    expect(addMonths(d, 6).toISOString()).toBe(new Date(Date.UTC(2026, 6, 15, 10, 0, 0)).toISOString());
    expect(addMonths(d, 12).toISOString()).toBe(new Date(Date.UTC(2027, 0, 15, 10, 0, 0)).toISOString());
  });

  it('addMonths preserves exact UTC time', () => {
    const d = new Date('2026-02-25T10:00:00.000Z');
    const next = addMonths(d, 6);
    expect(next.toISOString()).toBe('2026-08-25T10:00:00.000Z');
  });
});

describe('MaintenanceService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { record: jest.Mock };
  let notifications: { create: jest.Mock; createForUsers: jest.Mock };
  let service: MaintenanceService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = makePrisma();
    audit = { record: jest.fn() };
    notifications = { create: jest.fn().mockResolvedValue(undefined), createForUsers: jest.fn().mockResolvedValue(undefined) };
    service = new MaintenanceService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('listAssets', () => {
    it('scopes to building and filters by category', async () => {
      prisma.buildingAsset.findMany.mockResolvedValue([asset(), asset({ id: 'a2', category: 'BOILER', name: 'Λέβητας' })]);
      const result = await service.listAssets('building-1', user);
      expect(prisma.buildingAsset.findMany).toHaveBeenCalledWith({
        where: { buildingId: 'building-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('ELEVATOR');

      await service.listAssets('building-1', user, 'BOILER');
      expect(prisma.buildingAsset.findMany).toHaveBeenCalledWith({
        where: { buildingId: 'building-1', category: 'BOILER' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('rejects foreign building and invalid category', async () => {
      await expect(service.listAssets('building-9', user)).rejects.toThrow(ForbiddenException);
      await expect(service.listAssets('building-1', user, 'INVALID' as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('createAsset', () => {
    it('creates asset with tenant scoping and audit', async () => {
      const created = asset();
      prisma.buildingAsset.create.mockResolvedValue(created);
      const dto = { name: 'Ανελκυστήρας κεντρικός', category: 'ELEVATOR' as const, location: 'Ισόγειο' };
      const result = await service.createAsset('building-1', dto as any, user);
      expect(result.name).toBe('Ανελκυστήρας κεντρικός');
      expect(prisma.buildingAsset.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ buildingId: 'building-1', name: 'Ανελκυστήρας κεντρικός', category: 'ELEVATOR', location: 'Ισόγειο' }),
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'maintenance.asset.created' }));
    });

    it('rejects foreign building', async () => {
      await expect(service.createAsset('building-9', { name: 'X', category: 'ROOF' } as any, user)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('updateAsset / deleteAsset', () => {
    it('updates owned asset', async () => {
      prisma.buildingAsset.findFirst.mockResolvedValue(asset());
      prisma.buildingAsset.update.mockResolvedValue(asset({ name: 'Νέο όνομα' }));
      await service.updateAsset('building-1', 'asset-1', { name: 'Νέο όνομα' } as any, user);
      expect(prisma.buildingAsset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: { name: 'Νέο όνομα' },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'maintenance.asset.updated' }));
    });

    it('hides foreign assets behind 404', async () => {
      prisma.buildingAsset.findFirst.mockResolvedValue(null);
      await expect(service.updateAsset('building-1', 'missing', { name: 'X' } as any, user)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteAsset('building-1', 'missing', user)).rejects.toThrow(NotFoundException);
    });

    it('deletes owned asset and audits', async () => {
      prisma.buildingAsset.findFirst.mockResolvedValue(asset());
      await service.deleteAsset('building-1', 'asset-1', user);
      expect(prisma.buildingAsset.delete).toHaveBeenCalledWith({ where: { id: 'asset-1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'maintenance.asset.deleted' }));
    });
  });

  describe('listSchedules', () => {
    it('returns schedules with daysLeft and status, default 30 days window', async () => {
      prisma.maintenanceSchedule.findMany.mockResolvedValue([
        schedule({ nextDueAt: new Date('2026-08-20T10:00:00.000Z') }), // overdue -5
        schedule({ id: 's2', nextDueAt: new Date('2026-08-28T10:00:00.000Z'), title: 'Λέβητας' }), // urgent 3
      ]);
      const result = await service.listSchedules('building-1', user, {});
      expect(result[0].status).toBe('overdue');
      expect(result[0].daysLeft).toBe(-5);
      expect(result[1].status).toBe('urgent');
      expect(result[1].daysLeft).toBe(3);
      const where = prisma.maintenanceSchedule.findMany.mock.calls[0][0].where;
      expect(where.buildingId).toBe('building-1');
      expect(new Date(where.nextDueAt.lte).toISOString()).toBe(new Date('2026-09-24T10:00:00.000Z').toISOString());
    });

    it('filters by upcomingDays and category via asset relation', async () => {
      await service.listSchedules('building-1', user, { upcomingDays: '7', category: 'ELEVATOR' });
      const where = prisma.maintenanceSchedule.findMany.mock.calls[0][0].where;
      expect(where.asset).toEqual({ category: 'ELEVATOR' });
      expect(new Date(where.nextDueAt.lte).toISOString()).toBe(new Date('2026-09-01T10:00:00.000Z').toISOString());
    });

    it('rejects foreign building and bad category/upcomingDays', async () => {
      await expect(service.listSchedules('building-9', user, {})).rejects.toThrow(ForbiddenException);
      await expect(service.listSchedules('building-1', user, { category: 'BAD' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.listSchedules('building-1', user, { upcomingDays: '-5' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.listSchedules('building-1', user, { upcomingDays: 'soon' as any })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createSchedule', () => {
    it('computes nextDueAt = lastDoneAt + intervalMonths', async () => {
      prisma.buildingAsset.findFirst.mockResolvedValue(asset());
      const created = schedule({ lastDoneAt: new Date('2026-02-25T10:00:00.000Z'), nextDueAt: new Date('2026-08-25T10:00:00.000Z') });
      prisma.maintenanceSchedule.create.mockResolvedValue(created);
      const dto = {
        assetId: 'asset-1',
        title: 'Συντήρηση ανελκυστήρα',
        intervalMonths: 6,
        lastDoneAt: '2026-02-25T10:00:00.000Z',
      };
      const result = await service.createSchedule('building-1', dto as any, user);
      expect(result.nextDueAt).toBe('2026-08-25T10:00:00.000Z');
      expect(prisma.maintenanceSchedule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          assetId: 'asset-1',
          buildingId: 'building-1',
          title: 'Συντήρηση ανελκυστήρα',
          intervalMonths: 6,
          nextDueAt: new Date('2026-08-25T10:00:00.000Z'),
        }),
        include: { asset: true },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'maintenance.schedule.created' }));
    });

    it('computes nextDueAt = now + intervalMonths when lastDoneAt absent', async () => {
      prisma.buildingAsset.findFirst.mockResolvedValue(asset());
      const expectedNext = new Date('2027-02-25T10:00:00.000Z'); // NOW + 6 months
      prisma.maintenanceSchedule.create.mockResolvedValue(
        schedule({ lastDoneAt: null, nextDueAt: expectedNext }),
      );
      await service.createSchedule(
        'building-1',
        { assetId: 'asset-1', title: 'Λέβητας', intervalMonths: 6 } as any,
        user,
      );
      expect(prisma.maintenanceSchedule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ nextDueAt: expectedNext }),
        include: { asset: true },
      });
    });

    it('rejects asset of other building and invalid interval', async () => {
      prisma.buildingAsset.findFirst.mockResolvedValue(null);
      await expect(
        service.createSchedule('building-1', { assetId: 'other', title: 'X', intervalMonths: 6 } as any, user),
      ).rejects.toThrow(NotFoundException);
      prisma.buildingAsset.findFirst.mockResolvedValue(asset());
      await expect(
        service.createSchedule('building-1', { assetId: 'asset-1', title: 'X', intervalMonths: 0 } as any, user),
      ).rejects.toThrow(BadRequestException);
      await expect(service.createSchedule('building-9', { assetId: 'asset-1', title: 'X', intervalMonths: 6 } as any, user)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('validates expenseCategory belongs to building', async () => {
      prisma.buildingAsset.findFirst.mockResolvedValue(asset());
      prisma.expenseCategory.findFirst.mockResolvedValue(null);
      await expect(
        service.createSchedule(
          'building-1',
          { assetId: 'asset-1', title: 'X', intervalMonths: 3, expenseCategoryId: 'bad' } as any,
          user,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSchedule / deleteSchedule', () => {
    it('recomputes nextDueAt when intervalMonths changes', async () => {
      prisma.maintenanceSchedule.findFirst.mockResolvedValue(schedule());
      prisma.maintenanceSchedule.update.mockResolvedValue(
        schedule({ intervalMonths: 12, nextDueAt: new Date('2027-02-25T10:00:00.000Z') }),
      );
      await service.updateSchedule('building-1', 'sched-1', { intervalMonths: 12 } as any, user);
      expect(prisma.maintenanceSchedule.update).toHaveBeenCalledWith({
        where: { id: 'sched-1' },
        data: expect.objectContaining({ intervalMonths: 12, nextDueAt: new Date('2027-02-25T10:00:00.000Z') }),
        include: { asset: true },
      });
    });

    it('throws NotFound for foreign schedule', async () => {
      prisma.maintenanceSchedule.findFirst.mockResolvedValue(null);
      await expect(service.updateSchedule('building-1', 'missing', { title: 'X' } as any, user)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.deleteSchedule('building-1', 'missing', user)).rejects.toThrow(NotFoundException);
    });

    it('deletes owned schedule', async () => {
      prisma.maintenanceSchedule.findFirst.mockResolvedValue(schedule());
      await service.deleteSchedule('building-1', 'sched-1', user);
      expect(prisma.maintenanceSchedule.delete).toHaveBeenCalledWith({ where: { id: 'sched-1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'maintenance.schedule.deleted' }));
    });
  });

  describe('markDone', () => {
    it('sets lastDoneAt=now and nextDueAt=now+intervalMonths', async () => {
      prisma.maintenanceSchedule.findFirst.mockResolvedValue(schedule({ intervalMonths: 6 }));
      const updated = schedule({
        lastDoneAt: NOW,
        nextDueAt: new Date('2027-02-25T10:00:00.000Z'),
      });
      prisma.maintenanceSchedule.update.mockResolvedValue(updated);
      const result = await service.markDone('building-1', 'sched-1', {} as any, user);
      expect(prisma.maintenanceSchedule.update).toHaveBeenCalledWith({
        where: { id: 'sched-1' },
        data: { lastDoneAt: NOW, nextDueAt: new Date('2027-02-25T10:00:00.000Z') },
        include: { asset: true },
      });
      expect(result.lastDoneAt).toBe(NOW.toISOString());
      expect(result.nextDueAt).toBe('2027-02-25T10:00:00.000Z');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'maintenance.schedule.mark_done' }));
    });

    it('throws NotFound and Forbidden appropriately', async () => {
      prisma.maintenanceSchedule.findFirst.mockResolvedValue(null);
      await expect(service.markDone('building-1', 'missing', {} as any, user)).rejects.toThrow(NotFoundException);
      await expect(service.markDone('building-9', 'sched-1', {} as any, user)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('generateDueJobs', () => {
    it('creates draft jobs for due schedules, notifies admins, audits', async () => {
      prisma.maintenanceSchedule.findMany.mockResolvedValue([
        schedule({ id: 'sched-due', nextDueAt: new Date('2026-08-26T10:00:00.000Z'), autoCreateJob: true }),
        schedule({
          id: 'sched-future',
          nextDueAt: new Date('2026-12-01T00:00:00.000Z'),
          title: 'Μελλοντικό',
          autoCreateJob: true,
        }),
      ]);
      // Only first is within 30d; second is beyond cutoff (Sept 24). But our mock returns both; service filters by where lte cutoff, but findMany mock already returns filtered.
      // We simulate that findMany already did filtering and returns only due ones
      prisma.maintenanceSchedule.findMany.mockResolvedValue([
        schedule({ id: 'sched-due', nextDueAt: new Date('2026-08-26T10:00:00.000Z'), autoCreateJob: true }),
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
      prisma.job.findFirst.mockResolvedValue(null);

      const result = await service.generateDueJobs('building-1', user);
      expect(result).toEqual({ created: 1, skipped: 0 });
      expect(prisma.job.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          title: 'Συντήρηση ανελκυστήρα',
          status: 'OPEN',
          source: 'MAINTENANCE_SCHEDULE',
        }),
      });
      expect(notifications.createForUsers).toHaveBeenCalledWith(
        ['admin-1', 'admin-2'],
        expect.objectContaining({ type: 'maintenance.due', title: expect.stringContaining('Συντήρηση ανελκυστήρα') }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'maintenance.generate_jobs' }));
    });

    it('is idempotent: skips when job with same title already exists', async () => {
      prisma.maintenanceSchedule.findMany.mockResolvedValue([
        schedule({ nextDueAt: new Date('2026-08-26T10:00:00.000Z') }),
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      prisma.job.findFirst.mockResolvedValue({ id: 'existing-job', title: 'Συντήρηση ανελκυστήρα' } as any);

      const result = await service.generateDueJobs('building-1', user);
      expect(result).toEqual({ created: 0, skipped: 1 });
      expect(prisma.job.create).not.toHaveBeenCalled();
      expect(notifications.createForUsers).not.toHaveBeenCalled();
    });

    it('returns zeros when nothing due and respects tenant isolation', async () => {
      prisma.maintenanceSchedule.findMany.mockResolvedValue([]);
      await expect(service.generateDueJobs('building-1', user)).resolves.toEqual({ created: 0, skipped: 0 });
      expect(prisma.job.create).not.toHaveBeenCalled();

      await expect(service.generateDueJobs('building-9', user)).rejects.toThrow(ForbiddenException);
    });

    it('skips schedules with autoCreateJob=false via query filter', async () => {
      await service.generateDueJobs('building-1', user);
      const where = prisma.maintenanceSchedule.findMany.mock.calls[0][0].where;
      expect(where.autoCreateJob).toBe(true);
      expect(where.nextDueAt.lte.getTime()).toBe(new Date('2026-09-24T10:00:00.000Z').getTime());
    });
  });

  describe('getCalendar', () => {
    it('returns assets+schedules mapped to events with overdue/urgent status', async () => {
      prisma.buildingAsset.findMany.mockResolvedValue([asset()]);
      prisma.maintenanceSchedule.findMany.mockResolvedValue([
        schedule({ id: 'overdue', nextDueAt: new Date('2026-08-20T10:00:00.000Z') }),
        schedule({ id: 'urgent', nextDueAt: new Date('2026-08-27T10:00:00.000Z') }),
        schedule({ id: 'upcoming', nextDueAt: new Date('2026-09-10T10:00:00.000Z') }),
      ]);
      const result = await service.getCalendar('building-1', user, {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-30T23:59:59.000Z',
      });
      expect(result.assets).toHaveLength(1);
      expect(result.schedules).toHaveLength(3);
      expect(result.events).toHaveLength(3);
      expect(result.events.find((e: any) => e.id === 'overdue')!.status).toBe('overdue');
      expect(result.events.find((e: any) => e.id === 'urgent')!.status).toBe('urgent');
      expect(result.events.find((e: any) => e.id === 'upcoming')!.status).toBe('upcoming');
      expect(result.events[0].assetName).toBe('Ανελκυστήρας κεντρικός');
    });

    it('defaults from/to to current month when not supplied', async () => {
      prisma.buildingAsset.findMany.mockResolvedValue([]);
      prisma.maintenanceSchedule.findMany.mockResolvedValue([]);
      const result = await service.getCalendar('building-1', user, {});
      expect(result.from).toBe(new Date(Date.UTC(2026, 7, 1)).toISOString());
      expect(new Date(result.to).getUTCMonth()).toBe(7); // August
    });

    it('validates from/to and tenant', async () => {
      await expect(service.getCalendar('building-9', user, {})).rejects.toThrow(ForbiddenException);
      await expect(service.getCalendar('building-1', user, { from: 'bad' })).rejects.toThrow(BadRequestException);
      await expect(
        service.getCalendar('building-1', user, {
          from: '2026-09-30T00:00:00.000Z',
          to: '2026-08-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('queries schedules within from-to range ordered asc', async () => {
      prisma.buildingAsset.findMany.mockResolvedValue([]);
      prisma.maintenanceSchedule.findMany.mockResolvedValue([]);
      await service.getCalendar('building-1', user, {
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T23:59:59.000Z',
      });
      const where = prisma.maintenanceSchedule.findMany.mock.calls[0][0].where;
      expect(where.buildingId).toBe('building-1');
      expect(new Date(where.nextDueAt.gte).toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(new Date(where.nextDueAt.lte).toISOString()).toBe('2026-08-31T23:59:59.000Z');
    });
  });
});
