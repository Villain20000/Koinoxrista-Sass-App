import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VotesService } from './votes.service';

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

const notificationsStub = (): NotificationsService =>
  ({
    create: jest.fn(),
    createForUsers: jest.fn(),
  }) as unknown as NotificationsService;

const admin = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
  ...overrides,
});

const resident = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'resident-1',
  email: 'resident@demo.gr',
  role: 'RESIDENT',
  buildingId: 'building-1',
  ...overrides,
});

function makeVote(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 'vote-1',
    buildingId: 'building-1',
    topic: 'Lift repair',
    description: null,
    thresholdType: 'SIMPLE_MAJORITY',
    opensAt: new Date(now - 60_000),
    closesAt: new Date(now + 3_600_000),
    result: null,
    _count: { ballots: 0 },
    ...overrides,
  };
}

function makePrisma() {
  return {
    vote: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    ownership: { findMany: jest.fn().mockResolvedValue([]) },
    ballot: {
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    unit: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('VotesService', () => {
  let service: VotesService;
  let prisma: ReturnType<typeof makePrisma>;
  let notifications: NotificationsService;

  beforeEach(() => {
    prisma = makePrisma();
    notifications = notificationsStub();
    service = new VotesService(
      prisma as unknown as PrismaService,
      auditStub(),
      notifications,
      {
        publishToUser: jest.fn(),
        publishToBuilding: jest.fn(),
        publish: jest.fn(),
        subscribe: jest.fn(),
        disconnect: jest.fn(),
        merge: jest.fn(),
      } as unknown as import('../realtime/realtime.service').RealtimeService,
    );
  });

  describe('create', () => {
    const dto = {
      topic: 'Lift repair',
      thresholdType: 'SIMPLE_MAJORITY' as const,
      closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    };

    it('creates a vote with opensAt defaulting to now', async () => {
      prisma.vote.create.mockResolvedValue(makeVote());

      await service.create('building-1', dto, admin());

      expect(prisma.vote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buildingId: 'building-1',
            topic: 'Lift repair',
            thresholdType: 'SIMPLE_MAJORITY',
          }),
        }),
      );
      const data = prisma.vote.create.mock.calls[0][0].data;
      expect(data.opensAt).toBeInstanceOf(Date);
    });

    it('rejects a closesAt in the past', async () => {
      await expect(
        service.create(
          'building-1',
          { ...dto, closesAt: new Date(Date.now() - 1000).toISOString() },
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.vote.create).not.toHaveBeenCalled();
    });

    it('rejects opensAt after closesAt', async () => {
      await expect(
        service.create(
          'building-1',
          {
            ...dto,
            opensAt: new Date(Date.now() + 172_800_000).toISOString(),
          },
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces the tenant boundary', async () => {
      await expect(
        service.create('building-2', dto, admin({ buildingId: 'building-1' })),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.vote.create).not.toHaveBeenCalled();
    });

    it('notifies building owners about the new vote', async () => {
      prisma.vote.create.mockResolvedValue(makeVote());
      prisma.ownership.findMany.mockResolvedValue([
        { userId: 'owner-1' },
        { userId: 'owner-2' },
      ]);

      await service.create('building-1', dto, admin());

      expect(prisma.ownership.findMany).toHaveBeenCalledWith({
        where: { unit: { buildingId: 'building-1' } },
        select: { userId: true },
        distinct: ['userId'],
      });
      expect(notifications.createForUsers).toHaveBeenCalledWith(
        ['owner-1', 'owner-2'],
        {
          type: 'vote.opened',
          title: 'Νέα ψηφοφορία: Lift repair',
          linkPath: '/votes',
          sms: { kind: 'vote.opened', topic: 'Lift repair', periodKey: 'vote-1' },
        },
      );
    });
  });

  describe('list', () => {
    it('derives SCHEDULED, OPEN and CLOSED statuses in closesAt order', async () => {
      const now = Date.now();
      prisma.vote.findMany.mockResolvedValue([
        makeVote({
          id: 'vote-future',
          opensAt: new Date(now + 60_000),
          closesAt: new Date(now + 120_000),
        }),
        makeVote({ id: 'vote-open' }),
        makeVote({
          id: 'vote-closed-by-time',
          closesAt: new Date(now - 60_000),
        }),
        makeVote({
          id: 'vote-closed-by-result',
          result: JSON.stringify({ outcome: 'PASSED' }),
          closesAt: new Date(now + 120_000),
        }),
      ]);

      const items = await service.list('building-1', resident());

      expect(items.map((i) => i.status)).toEqual([
        'SCHEDULED',
        'OPEN',
        'CLOSED',
        'CLOSED',
      ]);
      expect(items[3].result).toBe('PASSED');
      expect(items[1].ballotsCount).toBe(0);
      expect(prisma.vote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buildingId: 'building-1' },
          orderBy: { closesAt: 'asc' },
        }),
      );
    });
  });

  describe('get', () => {
    it('returns the vote with myBallots limited to owned units and a PENDING tally while open', async () => {
      const vote = makeVote({ thresholdType: 'MILLIMES_MAJORITY' });
      prisma.vote.findUnique.mockResolvedValue(vote);
      prisma.ownership.findMany.mockResolvedValue([
        { unitId: 'unit-a', unit: { label: 'A' } },
      ]);
      prisma.ballot.findMany.mockResolvedValue([
        { id: 'b-1', unitId: 'unit-a', choice: 'YES' },
        { id: 'b-2', unitId: 'unit-b', choice: 'NO' },
      ]);
      prisma.unit.findMany.mockResolvedValue([
        { id: 'unit-a', millimes: 300 },
        { id: 'unit-b', millimes: 200 },
      ]);

      const detail = await service.get('vote-1', resident());

      expect(detail.myBallots).toEqual([
        { id: 'b-1', choice: 'YES', votedAt: '' },
      ]);
      expect(detail.tally.outcome).toBe('PENDING');
      expect(detail.tally.yesMillimes).toBe(300);
      expect(detail.tally.totalMillimes).toBe(500);
      expect(detail.tally.quorumMet).toBe(true);
    });

    it('counts HEADCOUNT votes per unit regardless of ownership weights (P0-3)', async () => {
      prisma.vote.findUnique.mockResolvedValue(
        makeVote({ thresholdType: 'HEADCOUNT' }),
      );
      prisma.ownership.findMany.mockResolvedValue([]);
      prisma.ballot.findMany.mockResolvedValue([
        { id: 'b-1', unitId: 'unit-a', choice: 'YES' },
        { id: 'b-2', unitId: 'unit-b', choice: 'NO' },
      ]);
      prisma.unit.findMany.mockResolvedValue([
        { id: 'unit-a', millimes: 900, shareFraction: 900 },
        { id: 'unit-b', millimes: 100, shareFraction: 100 },
      ]);

      const detail = await service.get('vote-1', resident());

      // One unit each → equal weight even though unit-a holds 900‰.
      expect(detail.tally.yesMillimes).toBe(1);
      expect(detail.tally.noMillimes).toBe(1);
      expect(detail.tally.totalMillimes).toBe(2);
      expect(detail.tally.outcome).toBe('PENDING'); // still open
    });

    it('weights the tally by ownership share when units carry shareFraction (P0-3)', async () => {
      prisma.vote.findUnique.mockResolvedValue(
        makeVote({ thresholdType: 'MILLIMES_MAJORITY' }),
      );
      prisma.ownership.findMany.mockResolvedValue([]);
      prisma.ballot.findMany.mockResolvedValue([
        { id: 'b-1', unitId: 'unit-a', choice: 'YES' },
        { id: 'b-2', unitId: 'unit-b', choice: 'NO' },
      ]);
      prisma.unit.findMany.mockResolvedValue([
        { id: 'unit-a', millimes: 100, shareFraction: 600 },
        { id: 'unit-b', millimes: 100, shareFraction: 400 },
      ]);

      const detail = await service.get('vote-1', resident());

      expect(detail.tally.yesMillimes).toBe(600);
      expect(detail.tally.noMillimes).toBe(400);
      expect(detail.tally.totalMillimes).toBe(1000);
    });

    it('exposes the stored outcome once the vote is closed by time', async () => {
      const now = Date.now();
      prisma.vote.findUnique.mockResolvedValue(
        makeVote({ closesAt: new Date(now - 1000) }),
      );
      prisma.ownership.findMany.mockResolvedValue([]);
      prisma.ballot.findMany.mockResolvedValue([
        { id: 'b-1', unitId: 'unit-a', choice: 'YES' },
      ]);
      prisma.unit.findMany.mockResolvedValue([{ id: 'unit-a', millimes: 500 }]);

      const detail = await service.get('vote-1', resident());

      expect(detail.tally.outcome).toBe('PASSED');
    });

    it('throws NotFound for an unknown vote', async () => {
      prisma.vote.findUnique.mockResolvedValue(null);

      await expect(service.get('missing', resident())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('castBallot', () => {
    const dto = { choice: 'YES' as const };

    function openVote() {
      const now = Date.now();
      return makeVote({
        opensAt: new Date(now - 60_000),
        closesAt: new Date(now + 60_000),
      });
    }

    it('upserts one ballot per owned unit and returns ballot views', async () => {
      prisma.vote.findUnique.mockResolvedValue(openVote());
      prisma.ownership.findMany.mockResolvedValue([
        { unitId: 'unit-a', unit: { label: 'A' } },
        { unitId: 'unit-b', unit: { label: 'B' } },
      ]);
      prisma.ballot.upsert.mockImplementation((args) =>
        Promise.resolve({
          id: `ballot-${args.where.voteId_unitId.unitId}`,
          choice: args.update.choice,
        }),
      );

      const views = await service.castBallot('vote-1', dto, resident());

      expect(prisma.ballot.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.ballot.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { voteId_unitId: { voteId: 'vote-1', unitId: 'unit-a' } },
          update: { choice: 'YES' },
          create: { voteId: 'vote-1', unitId: 'unit-a', choice: 'YES' },
        }),
      );
      expect(views).toHaveLength(2);
      expect(views[0]).toEqual({
        id: 'ballot-unit-a',
        choice: 'YES',
        votedAt: '',
      });
    });

    it('rejects voting before the window opens', async () => {
      prisma.vote.findUnique.mockResolvedValue(
        makeVote({ opensAt: new Date(Date.now() + 60_000) }),
      );

      await expect(
        service.castBallot('vote-1', dto, resident()),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.ballot.upsert).not.toHaveBeenCalled();
    });

    it('rejects voting after the window closes', async () => {
      prisma.vote.findUnique.mockResolvedValue(
        makeVote({ closesAt: new Date(Date.now() - 60_000) }),
      );

      await expect(
        service.castBallot('vote-1', dto, resident()),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects voting on a closed vote that already has a result', async () => {
      prisma.vote.findUnique.mockResolvedValue(
        makeVote({ result: JSON.stringify({ outcome: 'REJECTED' }) }),
      );

      await expect(
        service.castBallot('vote-1', dto, resident()),
      ).rejects.toThrow(BadRequestException);
    });

    it('forbids residents without any owned unit in the building', async () => {
      prisma.vote.findUnique.mockResolvedValue(openVote());
      prisma.ownership.findMany.mockResolvedValue([]);

      await expect(
        service.castBallot('vote-1', dto, resident()),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.ballot.upsert).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('computes the tally, stores it as JSON and clamps closesAt to now', async () => {
      const future = new Date(Date.now() + 3_600_000);
      prisma.vote.findUnique.mockResolvedValue(
        makeVote({
          thresholdType: 'MILLIMES_MAJORITY',
          closesAt: future,
        }),
      );
      prisma.ballot.findMany.mockResolvedValue([
        { id: 'b-1', unitId: 'unit-a', choice: 'YES' },
        { id: 'b-2', unitId: 'unit-b', choice: 'NO' },
      ]);
      prisma.unit.findMany.mockResolvedValue([
        { id: 'unit-a', millimes: 600 },
        { id: 'unit-b', millimes: 400 },
      ]);
      prisma.vote.update.mockResolvedValue(
        makeVote({
          thresholdType: 'MILLIMES_MAJORITY',
          result: JSON.stringify({ outcome: 'PASSED' }),
          closesAt: new Date(),
        }),
      );

      const detail = await service.close('vote-1', admin());

      const updateArgs = prisma.vote.update.mock.calls[0][0];
      expect(JSON.parse(updateArgs.data.result).outcome).toBe('PASSED');
      expect(updateArgs.data.closesAt.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
      expect(updateArgs.data.closesAt.getTime()).toBeLessThan(
        future.getTime(),
      );
      expect(detail.tally.yesMillimes).toBe(600);
      expect(detail.tally.quorumMet).toBe(true);
    });

    it('notifies building owners when the vote is closed', async () => {
      prisma.vote.findUnique.mockResolvedValue(
        makeVote({ thresholdType: 'MILLIMES_MAJORITY' }),
      );
      prisma.ballot.findMany.mockResolvedValue([
        { id: 'b-1', unitId: 'unit-a', choice: 'YES' },
      ]);
      prisma.unit.findMany.mockResolvedValue([
        { id: 'unit-a', millimes: 500 },
      ]);
      prisma.vote.update.mockResolvedValue(
        makeVote({ result: JSON.stringify({ outcome: 'PASSED' }) }),
      );
      prisma.ownership.findMany.mockResolvedValue([{ userId: 'owner-1' }]);

      await service.close('vote-1', admin());

      expect(notifications.createForUsers).toHaveBeenCalledWith(['owner-1'], {
        type: 'vote.closed',
        title: 'Ολοκληρώθηκε η ψηφοφορία',
        linkPath: '/votes',
      });
    });

    it('does not re-notify on an idempotent close of an already closed vote', async () => {
      const stored = JSON.stringify({ yesCount: 0, outcome: 'PASSED' });
      prisma.vote.findUnique.mockResolvedValue(makeVote({ result: stored }));

      await service.close('vote-1', admin());

      expect(notifications.createForUsers).not.toHaveBeenCalled();
    });

    it('is idempotent: returns the stored tally without updating again', async () => {
      const stored = JSON.stringify({ yesCount: 1, outcome: 'PASSED' });
      prisma.vote.findUnique.mockResolvedValue(makeVote({ result: stored }));

      const detail = await service.close('vote-1', admin());

      expect(prisma.vote.update).not.toHaveBeenCalled();
      expect(detail.tally).toEqual({ yesCount: 1, outcome: 'PASSED' });
      expect(detail.result).toBe('PASSED');
    });
  });

  describe('listBallots', () => {
    it('lists ballots with unit labels for admins of the building', async () => {
      prisma.vote.findUnique.mockResolvedValue(makeVote());
      prisma.ballot.findMany.mockResolvedValue([
        { id: 'b-1', unitId: 'unit-a', choice: 'YES', unit: { label: 'A' } },
        { id: 'b-2', unitId: 'unit-b', choice: 'NO', unit: { label: 'B' } },
      ]);

      const rows = await service.listBallots('vote-1', admin());

      expect(rows).toEqual([
        { id: 'b-1', unitId: 'unit-a', unitLabel: 'A', choice: 'YES' },
        { id: 'b-2', unitId: 'unit-b', unitLabel: 'B', choice: 'NO' },
      ]);
      expect(prisma.ballot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { voteId: 'vote-1' } }),
      );
    });

    it('blocks callers from another building', async () => {
      prisma.vote.findUnique.mockResolvedValue(makeVote());

      await expect(
        service.listBallots('vote-1', admin({ buildingId: 'building-9' })),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.ballot.findMany).not.toHaveBeenCalled();
    });
  });
});
