import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CommissionsService } from '../marketplace/commission.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobsService } from './jobs.service';

const notificationsStub = (): NotificationsService =>
  ({
    create: jest.fn(),
    createForUsers: jest.fn(),
  }) as unknown as NotificationsService;

const commissionsStub = (): CommissionsService =>
  ({
    createForAward: jest.fn().mockResolvedValue(null),
  }) as unknown as CommissionsService;

const admin = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
  ...overrides,
});

const provider = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'provider-1',
  email: 'provider@demo.gr',
  role: 'PROVIDER',
  buildingId: null,
  ...overrides,
});

const bidRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'bid-1',
  jobId: 'job-1',
  amountCents: 5000,
  message: null,
  status: 'SUBMITTED',
  ratingStars: null,
  providerUserId: 'provider-1',
  provider: {
    firstName: 'Nikos',
    lastName: 'Papas',
    profile: { trade: 'Plumber' },
  },
  ...overrides,
});

type Tx = Record<string, Record<string, jest.Mock>>;

function makePrisma() {
  const tx: Tx = {
    bid: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    job: { update: jest.fn() },
    workLog: { create: jest.fn() },
    providerProfile: { upsert: jest.fn() },
  };

  const prisma = {
    building: { findUnique: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    job: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    bid: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    workLog: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    providerProfile: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((fn: (t: Tx) => Promise<unknown>) => fn(tx)),
  };

  return { prisma, tx };
}

describe('JobsService', () => {
  let service: JobsService;
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let tx: ReturnType<typeof makePrisma>['tx'];
  let notifications: NotificationsService;
  let commissions: CommissionsService;

  beforeEach(() => {
    ({ prisma, tx } = makePrisma());
    notifications = notificationsStub();
    commissions = commissionsStub();
    service = new JobsService(
      prisma as unknown as PrismaService,
      notifications,
      commissions,
    );
  });

  describe('createJob', () => {
    it('creates an OPEN job for the admin building', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'building-1' });
      prisma.job.create.mockResolvedValue({
        id: 'job-1',
        buildingId: 'building-1',
        title: 'Lift service',
        description: 'Annual service',
        budgetCents: null,
        status: 'OPEN',
      });

      const view = await service.createJob(
        'building-1',
        { title: 'Lift service', description: 'Annual service' },
        admin(),
      );

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          title: 'Lift service',
        }),
      });
      expect(view.status).toBe('OPEN');
      expect(view.workLogsCount).toBe(0);
    });

    it('rejects unknown buildings and foreign buildings', async () => {
      prisma.building.findUnique.mockResolvedValue(null);

      await expect(
        service.createJob(
          'building-1',
          { title: 'T', description: 'D' },
          admin(),
        ),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.createJob(
          'building-2',
          { title: 'T', description: 'D' },
          admin({ buildingId: 'building-1' }),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });
  });

  describe('createDefect', () => {
    const defect = {
      title: 'Broken lift door',
      description: 'The lift door jams between floors almost daily',
    };

    it('creates an OPEN resident report linked to the reporter', async () => {
      prisma.job.create.mockResolvedValue({
        id: 'job-77',
        buildingId: 'building-1',
        title: defect.title,
        description: defect.description,
        status: 'OPEN',
        budgetCents: null,
        source: 'RESIDENT_REPORT',
      });

      const view = await service.createDefect(
        'building-1',
        defect,
        admin({ role: 'RESIDENT', id: 'r-1', email: 'r@x.gr' }),
      );

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: {
          buildingId: 'building-1',
          title: defect.title,
          description: defect.description,
          status: 'OPEN',
          source: 'RESIDENT_REPORT',
          reportedById: 'r-1',
        },
      });
      expect(view).toMatchObject({
        id: 'job-77',
        title: defect.title,
        description: defect.description,
        status: 'OPEN',
        source: 'RESIDENT_REPORT',
        reporterName: null,
        workLogsCount: 0,
        bidsCount: 0,
      });
    });

    it('rejects reports for another building', async () => {
      await expect(
        service.createDefect('building-2', defect, admin({ role: 'RESIDENT' })),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it('refuses providers even with a matching building', async () => {
      prisma.building.findUnique.mockResolvedValue({ id: 'building-1' });

      await expect(
        service.createDefect(
          'building-1',
          defect,
          provider({ buildingId: 'building-1' }),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });
  });

  describe('listForBuilding', () => {
    it('returns bids for admins but strips them for residents', async () => {
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-1',
          buildingId: 'building-1',
          title: 'Lift service',
          description: 'd',
          status: 'OPEN',
          budgetCents: null,
          _count: { workLogs: 2, bids: 1 },
          bids: [bidRow()],
        },
      ]);

      const adminView = await service.listForBuilding('building-1', admin());
      const residentView = await service.listForBuilding(
        'building-1',
        admin({ role: 'RESIDENT', id: 'r-1', email: 'r@x.gr' }),
      );

      expect(adminView[0].bids).toHaveLength(1);
      expect(adminView[0].bids?.[0]).toMatchObject({
        providerName: 'Nikos Papas',
        providerTrade: 'Plumber',
        status: 'SUBMITTED',
      });
      expect(adminView[0].workLogsCount).toBe(2);
      expect(residentView[0].bids).toBeUndefined();
      expect(residentView[0].bidsCount).toBe(1);
    });

    it('scopes resident listings to published RFPs plus their own reports', async () => {
      prisma.job.findMany.mockResolvedValue([]);

      await service.listForBuilding(
        'building-1',
        admin({ role: 'RESIDENT', id: 'r-1', email: 'r@x.gr' }),
      );

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            buildingId: 'building-1',
            OR: [
              { source: 'ADMIN_RFP' },
              { source: 'RESIDENT_REPORT', reportedById: 'r-1' },
            ],
          },
        }),
      );
      const { include } = prisma.job.findMany.mock.calls[0][0] as {
        include: Record<string, unknown>;
      };
      expect(include.reportedBy).toBeUndefined();
    });

    it('carries source and reporter name on rows', async () => {
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-5',
          buildingId: 'building-1',
          title: 'Leak',
          description: 'd',
          status: 'OPEN',
          budgetCents: null,
          source: 'RESIDENT_REPORT',
          reportedBy: { firstName: 'Maria', lastName: 'Ioannou' },
          _count: { workLogs: 0, bids: 0 },
          bids: [],
        },
      ]);

      const views = await service.listForBuilding('building-1', admin());

      expect(views[0]).toMatchObject({
        source: 'RESIDENT_REPORT',
        reporterName: 'Maria Ioannou',
      });
    });
  });

  describe('marketplace + myBids', () => {
    it('lists only OPEN jobs across buildings with buildingName', async () => {
      prisma.job.findMany.mockResolvedValue([
        {
          id: 'job-9',
          buildingId: 'building-2',
          title: 'Roof fix',
          description: 'd',
          status: 'OPEN',
          budgetCents: 100_00,
          building: { name: 'Avgi' },
        },
      ]);

      const views = await service.marketplace();

      expect(prisma.job.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'OPEN', source: { not: 'RESIDENT_REPORT' } },
        }),
      );
      expect(views[0].buildingName).toBe('Avgi');
    });

    it('maps own bids with job and building info', async () => {
      prisma.bid.findMany.mockResolvedValue([
        {
          ...bidRow({ status: 'ACCEPTED', ratingStars: 5 }),
          job: {
            id: 'job-1',
            title: 'Lift service',
            status: 'AWARDED',
            building: { name: 'Avgi' },
          },
        },
      ]);

      const rows = await service.myBids('provider-1');

      expect(rows[0].bid.status).toBe('ACCEPTED');
      expect(rows[0].bid.providerName).toBe('Nikos Papas');
      expect(rows[0].job).toEqual({
        id: 'job-1',
        title: 'Lift service',
        status: 'AWARDED',
        buildingName: 'Avgi',
      });
    });
  });

  describe('createBid', () => {
    const dto = { amountCents: 7500, message: 'Can start Monday' };

    it('creates a SUBMITTED bid on an OPEN job', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', status: 'OPEN' });
      prisma.bid.findFirst.mockResolvedValue(null);
      prisma.bid.create.mockResolvedValue(bidRow({ amountCents: 7500 }));

      const view = await service.createBid('job-1', dto, provider());

      expect(prisma.bid.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            jobId: 'job-1',
            providerUserId: 'provider-1',
            amountCents: 7500,
            status: 'SUBMITTED',
          }),
        }),
      );
      expect(view.amountCents).toBe(7500);
    });

    it('upserts: replaces the existing bid instead of creating a second one', async () => {
      prisma.job.findUnique.mockResolvedValue({ id: 'job-1', status: 'OPEN' });
      prisma.bid.findFirst.mockResolvedValue(bidRow({ status: 'REJECTED' }));
      prisma.bid.update.mockResolvedValue(bidRow());

      await service.createBid('job-1', dto, provider());

      expect(prisma.bid.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bid-1' },
          data: expect.objectContaining({
            amountCents: 7500,
            status: 'SUBMITTED',
          }),
        }),
      );
      expect(prisma.bid.create).not.toHaveBeenCalled();
    });

    it('rejects bids on non-open jobs', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'AWARDED',
      });

      await expect(
        service.createBid('job-1', dto, provider()),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.bid.create).not.toHaveBeenCalled();
    });

    it('notifies the building admins about the new bid', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        buildingId: 'building-1',
        title: 'Lift service',
        status: 'OPEN',
      });
      prisma.bid.findFirst.mockResolvedValue(null);
      prisma.bid.create.mockResolvedValue(bidRow({ amountCents: 7500 }));
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      await service.createBid('job-1', dto, provider());

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: 'ADMIN', buildingId: 'building-1' },
        select: { id: true },
      });
      expect(notifications.createForUsers).toHaveBeenCalledWith(['admin-1'], {
        type: 'bid.received',
        title: 'Νέα προσφορά για εργασία',
        body: 'Lift service',
        linkPath: '/jobs',
      });
    });
  });

  describe('acceptBid', () => {
    function openBidTx(status = 'SUBMITTED') {
      tx.bid.findUnique.mockResolvedValue({
        ...bidRow({ status }),
        job: { id: 'job-1', buildingId: 'building-1', status: 'OPEN' },
      });
      tx.bid.update.mockResolvedValue(bidRow({ status: 'ACCEPTED' }));
    }

    it('accepts the bid, rejects siblings and awards the job in a transaction', async () => {
      openBidTx();

      const view = await service.acceptBid('bid-1', admin());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.bid.updateMany).toHaveBeenCalledWith({
        where: { jobId: 'job-1', id: { not: 'bid-1' }, status: 'SUBMITTED' },
        data: { status: 'REJECTED' },
      });
      expect(tx.bid.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bid-1' },
          data: { status: 'ACCEPTED' },
        }),
      );
      expect(tx.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-1' },
          data: { status: 'AWARDED' },
        }),
      );
      expect(view.status).toBe('ACCEPTED');
    });

    it('refuses to accept an already handled bid or on a non-open job', async () => {
      openBidTx('ACCEPTED');

      await expect(service.acceptBid('bid-1', admin())).rejects.toThrow(
        BadRequestException,
      );

      openBidTx();
      tx.bid.findUnique.mockResolvedValue({
        ...bidRow(),
        job: { id: 'job-1', buildingId: 'building-1', status: 'COMPLETED' },
      });

      await expect(service.acceptBid('bid-1', admin())).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.job.update).not.toHaveBeenCalled();
    });

    it('blocks admins of another building', async () => {
      openBidTx();
      tx.bid.findUnique.mockResolvedValue({
        ...bidRow(),
        job: { id: 'job-1', buildingId: 'building-2', status: 'OPEN' },
      });

      await expect(service.acceptBid('bid-1', admin())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('notifies the winning provider after the award commits', async () => {
      openBidTx();

      await service.acceptBid('bid-1', admin());

      expect(notifications.create).toHaveBeenCalledWith({
        userId: 'provider-1',
        type: 'bid.accepted',
        title: 'Η προσφορά σας έγινε αποδεκτή',
        linkPath: '/jobs',
      });
    });

    it('persists the platform commission for the awarded amount', async () => {
      openBidTx();

      await service.acceptBid('bid-1', admin());

      expect(commissions.createForAward).toHaveBeenCalledWith({
        buildingId: 'building-1',
        jobId: 'job-1',
        providerId: 'provider-1',
        baseCents: 5000,
      });
    });

    it('does not fail the award when commission creation throws', async () => {
      openBidTx();
      (commissions.createForAward as jest.Mock).mockRejectedValue(
        new Error('db down'),
      );
      const warn = jest
        .spyOn(console, 'warn')
        .mockImplementation(function noop() {
          /* silence expected warning */
        });

      await expect(service.acceptBid('bid-1', admin())).resolves.toMatchObject({
        status: 'ACCEPTED',
      });
      expect(tx.job.update).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('skips the commission write for rejected awards', async () => {
      openBidTx('ACCEPTED');

      await expect(service.acceptBid('bid-1', admin())).rejects.toThrow(
        BadRequestException,
      );
      expect(commissions.createForAward).not.toHaveBeenCalled();
    });
  });

  describe('rejectBid', () => {
    it('rejects a submitted bid', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        ...bidRow(),
        job: { id: 'job-1', buildingId: 'building-1', status: 'OPEN' },
      });
      prisma.bid.update.mockResolvedValue(bidRow({ status: 'REJECTED' }));

      const view = await service.rejectBid('bid-1', admin());

      expect(view.status).toBe('REJECTED');
    });

    it('only rejects SUBMITTED bids', async () => {
      prisma.bid.findUnique.mockResolvedValue({
        ...bidRow({ status: 'ACCEPTED' }),
        job: { id: 'job-1', buildingId: 'building-1', status: 'AWARDED' },
      });

      await expect(service.rejectBid('bid-1', admin())).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.bid.update).not.toHaveBeenCalled();
    });
  });

  describe('convertToRfp', () => {
    function reportRow(source: string) {
      return {
        id: 'job-7',
        buildingId: 'building-1',
        title: 'Leak',
        description: 'd',
        status: 'OPEN',
        budgetCents: null,
        source,
        reportedBy: { firstName: 'Maria', lastName: 'Ioannou' },
      };
    }

    it('promotes a resident report to an admin RFP', async () => {
      prisma.job.findUnique.mockResolvedValue(
        reportRow('RESIDENT_REPORT'),
      );
      prisma.job.update.mockResolvedValue(reportRow('ADMIN_RFP'));

      const view = await service.convertToRfp('job-7', admin());

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-7' },
          data: { source: 'ADMIN_RFP' },
        }),
      );
      expect(view.source).toBe('ADMIN_RFP');
    });

    it('is a no-op for admin-created RFPs', async () => {
      prisma.job.findUnique.mockResolvedValue(reportRow('ADMIN_RFP'));
      prisma.job.update.mockResolvedValue(reportRow('ADMIN_RFP'));

      const view = await service.convertToRfp('job-8', admin());

      expect(prisma.job.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'job-8' },
          data: {},
        }),
      );
      expect(view.source).toBe('ADMIN_RFP');
    });

    it('rejects unknown jobs and other buildings', async () => {
      prisma.job.findUnique.mockResolvedValue(null);
      await expect(service.convertToRfp('nope', admin())).rejects.toThrow(
        NotFoundException,
      );

      prisma.job.findUnique.mockResolvedValue({
        ...reportRow('RESIDENT_REPORT'),
        buildingId: 'building-2',
      });
      await expect(service.convertToRfp('job-7', admin())).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.job.update).not.toHaveBeenCalled();
    });
  });

  describe('addWorkLog', () => {
    it('flips AWARDED to IN_PROGRESS on the first log', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'AWARDED',
      });
      prisma.bid.findFirst.mockResolvedValue(
        bidRow({ status: 'ACCEPTED' }),
      );
      tx.workLog.create.mockResolvedValue({
        id: 'log-1',
        jobId: 'job-1',
        note: 'Started demolition',
        loggedAt: new Date('2026-08-24T10:00:00Z'),
      });

      const view = await service.addWorkLog(
        'job-1',
        { note: 'Started demolition' },
        provider(),
      );

      expect(tx.workLog.create).toHaveBeenCalledWith({
        data: {
          jobId: 'job-1',
          providerUserId: 'provider-1',
          note: 'Started demolition',
        },
      });
      expect(tx.job.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'IN_PROGRESS' },
      });
      expect(view.loggedAt).toBe('2026-08-24T10:00:00.000Z');
    });

    it('keeps IN_PROGRESS when logging after the first entry', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'IN_PROGRESS',
      });
      prisma.bid.findFirst.mockResolvedValue(bidRow({ status: 'ACCEPTED' }));
      tx.workLog.create.mockResolvedValue({
        id: 'log-2',
        jobId: 'job-1',
        note: 'Half done',
        loggedAt: new Date(),
      });

      await service.addWorkLog('job-1', { note: 'Half done' }, provider());

      expect(tx.job.update).not.toHaveBeenCalled();
    });

    it('forbids providers without the accepted bid', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        status: 'OPEN',
      });
      prisma.bid.findFirst.mockResolvedValue(null);

      await expect(
        service.addWorkLog('job-1', { note: 'nope' }, provider()),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('notifies the building admins when work is logged', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        buildingId: 'building-1',
        title: 'Lift service',
        status: 'IN_PROGRESS',
      });
      prisma.bid.findFirst.mockResolvedValue(bidRow({ status: 'ACCEPTED' }));
      tx.workLog.create.mockResolvedValue({
        id: 'log-3',
        jobId: 'job-1',
        note: 'Pipes replaced',
        loggedAt: new Date(),
      });
      prisma.user.findMany.mockResolvedValue([
        { id: 'admin-1' },
        { id: 'admin-2' },
      ]);

      await service.addWorkLog('job-1', { note: 'Pipes replaced' }, provider());

      expect(notifications.createForUsers).toHaveBeenCalledWith(
        ['admin-1', 'admin-2'],
        {
          type: 'worklog.added',
          title: 'Νέο ημερολόγιο εργασίας',
          body: 'Lift service',
          linkPath: '/jobs',
        },
      );
    });
  });

  describe('listWorkLogs', () => {
    it('allows building members and the awarded provider, newest first', async () => {
      prisma.job.findUnique
        .mockResolvedValueOnce({ id: 'job-1', buildingId: 'building-1' })
        .mockResolvedValueOnce({ id: 'job-1', buildingId: 'building-1' })
        .mockResolvedValueOnce({ id: 'job-1', buildingId: 'building-1' });
      prisma.bid.findFirst
        .mockResolvedValueOnce(undefined) // provider without award
        .mockResolvedValueOnce(bidRow({ status: 'ACCEPTED' })); // awarded provider
      prisma.workLog.findMany.mockResolvedValue([
        {
          id: 'log-2',
          jobId: 'job-1',
          note: 'later',
          loggedAt: new Date('2026-08-24T12:00:00Z'),
        },
        {
          id: 'log-1',
          jobId: 'job-1',
          note: 'earlier',
          loggedAt: new Date('2026-08-23T09:00:00Z'),
        },
      ]);

      const memberLogs = await service.listWorkLogs('job-1', admin());
      expect(memberLogs.map((l) => l.id)).toEqual(['log-2', 'log-1']);
      expect(prisma.workLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { loggedAt: 'desc' } }),
      );

      await expect(
        service.listWorkLogs('job-1', provider()),
      ).rejects.toThrow(ForbiddenException);

      const awardedLogs = await service.listWorkLogs(
        'job-1',
        provider({ buildingId: null }),
      );
      expect(awardedLogs).toHaveLength(2);
    });
  });

  describe('completeJob', () => {
    it('completes an IN_PROGRESS job', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        buildingId: 'building-1',
        status: 'IN_PROGRESS',
      });
      prisma.job.update.mockResolvedValue({
        id: 'job-1',
        buildingId: 'building-1',
        title: 'T',
        description: 'D',
        status: 'COMPLETED',
        budgetCents: null,
        _count: { workLogs: 3, bids: 2 },
      });

      const view = await service.completeJob('job-1', admin());

      expect(view.status).toBe('COMPLETED');
      expect(view.workLogsCount).toBe(3);
    });

    it('rejects completing an OPEN job', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        buildingId: 'building-1',
        status: 'OPEN',
      });

      await expect(service.completeJob('job-1', admin())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('rateAcceptedBid', () => {
    it('stores stars on the accepted bid and updates the provider average rating', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        buildingId: 'building-1',
      });
      tx.bid.findFirst.mockResolvedValue(
        bidRow({ status: 'ACCEPTED' }),
      );
      tx.bid.update.mockResolvedValue(
        bidRow({ status: 'ACCEPTED', ratingStars: 4 }),
      );
      tx.bid.findMany.mockResolvedValue([{ ratingStars: 5 }, { ratingStars: 3 }]);
      tx.providerProfile.upsert.mockResolvedValue({
        userId: 'provider-1',
        trade: 'Plumber',
        certs: [],
        rating: 4,
      });

      const result = await service.rateAcceptedBid(
        'job-1',
        { stars: 4 },
        admin(),
      );

      expect(tx.bid.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bid-1' },
          data: { ratingStars: 4 },
        }),
      );
      expect(result.providerRating).toBe(4);
      expect(tx.providerProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'provider-1' },
          update: { rating: 4 },
        }),
      );
    });

    it('fails when there is no accepted bid to rate', async () => {
      prisma.job.findUnique.mockResolvedValue({
        id: 'job-1',
        buildingId: 'building-1',
      });
      tx.bid.findFirst.mockResolvedValue(null);

      await expect(
        service.rateAcceptedBid('job-1', { stars: 5 }, admin()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('provider profile', () => {
    it('reads the own profile', async () => {
      prisma.providerProfile.findUnique.mockResolvedValue({
        userId: 'provider-1',
        trade: 'Plumber',
        certs: ['A'],
        rating: 4.5,
      });

      const profile = await service.getProviderProfile('provider-1');

      expect(profile?.trade).toBe('Plumber');
      expect(profile?.rating).toBe(4.5);
    });

    it('upserts trade and certs', async () => {
      prisma.providerProfile.upsert.mockResolvedValue({
        userId: 'provider-1',
        trade: 'Electrician',
        certs: ['ISO'],
        rating: null,
      });

      const profile = await service.upsertProviderProfile('provider-1', {
        trade: 'Electrician',
        certs: ['ISO'],
      });

      expect(prisma.providerProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'provider-1' },
          create: {
            userId: 'provider-1',
            trade: 'Electrician',
            certs: ['ISO'],
          },
        }),
      );
      expect(profile.trade).toBe('Electrician');
    });
  });
});
