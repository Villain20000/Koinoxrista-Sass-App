import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { VoteTally } from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssemblyService,
  buildAttendanceStats,
  buildDecisions,
  buildPraktiko,
} from './assembly.service';
import type { RealtimeService } from '../realtime/realtime.service';

function realtimeStub(): RealtimeService {
  return {
    publishToUser: jest.fn(),
    publishToBuilding: jest.fn(),
    publish: jest.fn(),
    subscribe: jest.fn(),
    disconnect: jest.fn(),
    merge: jest.fn(),
  } as unknown as RealtimeService;
}

function makePrisma() {
  return {
    vote: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    agendaItem: {
      aggregate: jest.fn().mockResolvedValue({ _max: { position: null } }),
      create: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
    },
    attendance: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
    unit: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ballot: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function makeAudit() {
  return { record: jest.fn() };
}

function makeLlm() {
  return { name: 'test', complete: jest.fn().mockResolvedValue('ΔΡΑΦΤ ΠΡΑΚΤΙΚΟΥ') };
}

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'admin@b.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

const voteRow = () => ({
  id: 'vote-1',
  buildingId: 'building-1',
  topic: 'Καθαρισμός ταράτσας',
  description: null,
  thresholdType: 'SIMPLE_MAJORITY',
  opensAt: new Date('2026-01-01T09:00:00Z'),
  closesAt: new Date('2099-01-01T09:00:00Z'),
  result: null,
  building: {
    id: 'building-1',
    name: 'Κάτοικος',
    address: 'Εγνατία 42',
    city: 'Thessaloniki',
  },
});

const passedTally: VoteTally = {
  yesCount: 2,
  noCount: 1,
  abstainCount: 0,
  yesMillimes: 600,
  noMillimes: 400,
  totalMillimes: 1000,
  quorumMet: true,
  outcome: 'PASSED',
};

describe('nextPosition via appendAgendaItem (ordering)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: AssemblyService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new AssemblyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      realtimeStub(),
      makeLlm() as any,
    );
    prisma.vote.findUnique.mockResolvedValue(voteRow());
  });

  it('appends new items at the end of the agenda (max position + 1)', async () => {
    prisma.agendaItem.aggregate.mockResolvedValue({ _max: { position: 3 } });
    prisma.agendaItem.create.mockResolvedValue({
      id: 'item-4',
      voteId: 'vote-1',
      position: 4,
      title: 'Διάφορα',
      body: null,
    });

    await expect(
      service.appendAgendaItem(
        'vote-1',
        { title: 'Διάφορα' },
        user,
      ),
    ).resolves.toMatchObject({ position: 4, title: 'Διάφορα' });

    expect(prisma.agendaItem.create).toHaveBeenCalledWith({
      data: {
        voteId: 'vote-1',
        buildingId: 'building-1',
        position: 4,
        title: 'Διάφορα',
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assembly.agenda.created' }),
    );
  });

  it('starts the agenda at position 1 for an empty vote', async () => {
    prisma.agendaItem.aggregate.mockResolvedValue({ _max: { position: null } });
    prisma.agendaItem.create.mockImplementation(async ({ data }) => data);

    await service.appendAgendaItem('vote-1', { title: 'Πρώτο θέμα' }, user);

    expect(prisma.agendaItem.create.mock.calls[0][0].data.position).toBe(1);
  });

  it('lists the agenda ordered by position', async () => {
    prisma.agendaItem.findMany.mockResolvedValue([
      { id: 'a', voteId: 'vote-1', position: 1, title: 'Α', body: null },
    ]);

    await service.listAgenda('vote-1', user);

    expect(prisma.agendaItem.findMany).toHaveBeenCalledWith({
      where: { voteId: 'vote-1' },
      orderBy: { position: 'asc' },
    });
  });

  it('forbids another building (tenancy)', async () => {
    const outsider = { ...user, buildingId: 'building-2' };
    await expect(
      service.listAgenda('vote-1', outsider),
    ).rejects.toThrow(/another building/i);
  });
});

describe('duplicate position rejection', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: AssemblyService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new AssemblyService(
      prisma as unknown as PrismaService,
      makeAudit() as unknown as AuditService,
      realtimeStub(),
      makeLlm() as any,
    );
    prisma.vote.findUnique.mockResolvedValue(voteRow());
  });

  it('maps P2002 on append to 409 Conflict', async () => {
    prisma.agendaItem.aggregate.mockResolvedValue({ _max: { position: 1 } });
    prisma.agendaItem.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.appendAgendaItem('vote-1', { title: 'Διπλό' }, user),
    ).rejects.toThrow(ConflictException);
  });

  it('maps P2002 on reorder to 409 Conflict', async () => {
    prisma.agendaItem.findUnique.mockResolvedValue({
      id: 'item-1',
      voteId: 'vote-1',
      buildingId: 'building-1',
      position: 1,
      title: 'Α',
      body: null,
    });
    prisma.agendaItem.update.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.updateAgendaItem('item-1', { position: 2 }, user),
    ).rejects.toThrow(ConflictException);
  });
});

describe('attendance toggle', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: AssemblyService;
  const unit = { id: 'unit-1', label: 'Ισόγειο', millimes: 250 };

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new AssemblyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      realtimeStub(),
      makeLlm() as any,
    );
    prisma.vote.findUnique.mockResolvedValue(voteRow());
    prisma.unit.findFirst.mockResolvedValue(unit);
  });

  it('checks a unit in and stamps checkedInAt', async () => {
    prisma.attendance.upsert.mockResolvedValue({
      id: 'att-1',
      voteId: 'vote-1',
      unitId: 'unit-1',
      present: true,
      proxyUnitId: null,
      checkedInAt: new Date('2026-01-01T10:00:00Z'),
    });

    await expect(
      service.toggleAttendance('vote-1', { unitId: 'unit-1', present: true }, user),
    ).resolves.toMatchObject({
      unitLabel: 'Ισόγειο',
      millimes: 250,
      present: true,
      checkedInAt: '2026-01-01T10:00:00.000Z',
    });

    expect(prisma.attendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ present: true }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assembly.attendance' }),
    );
  });

  it('is idempotent: identical state neither writes nor re-audits', async () => {
    prisma.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      voteId: 'vote-1',
      unitId: 'unit-1',
      present: true,
      proxyUnitId: null,
      checkedInAt: new Date('2026-01-01T10:00:00Z'),
    });

    await expect(
      service.toggleAttendance('vote-1', { unitId: 'unit-1', present: true }, user),
    ).resolves.toMatchObject({ present: true });

    expect(prisma.attendance.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('writes when the presence state actually changes', async () => {
    prisma.attendance.findUnique.mockResolvedValue({
      id: 'att-1',
      voteId: 'vote-1',
      unitId: 'unit-1',
      present: true,
      proxyUnitId: null,
      checkedInAt: new Date('2026-01-01T10:00:00Z'),
    });
    prisma.attendance.upsert.mockResolvedValue({
      id: 'att-1',
      voteId: 'vote-1',
      unitId: 'unit-1',
      present: false,
      proxyUnitId: null,
      checkedInAt: null,
    });

    await service.toggleAttendance(
      'vote-1',
      { unitId: 'unit-1', present: false },
      user,
    );

    expect(prisma.attendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { present: false, proxyUnitId: null, checkedInAt: null },
      }),
    );
  });

  it('rejects a unit that is not part of the vote building', async () => {
    prisma.unit.findFirst.mockResolvedValue(null);

    await expect(
      service.toggleAttendance('vote-1', { unitId: 'nope', present: true }, user),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a unit acting as its own proxy', async () => {
    await expect(
      service.toggleAttendance(
        'vote-1',
        { unitId: 'unit-1', present: true, proxyUnitId: 'unit-1' },
        user,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unknown proxy unit', async () => {
    prisma.unit.findFirst
      .mockResolvedValueOnce(unit)
      .mockResolvedValueOnce(null);

    await expect(
      service.toggleAttendance(
        'vote-1',
        { unitId: 'unit-1', present: true, proxyUnitId: 'ghost' },
        user,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('buildAttendanceStats (quorum math)', () => {
  const units = [
    { id: 'u1', millimes: 300 },
    { id: 'u2', millimes: 700 },
  ];

  it('sums only present units; half is short of SIMPLE_MAJORITY quorum here', () => {
    const stats = buildAttendanceStats('SIMPLE_MAJORITY', units, [
      { unitId: 'u1', present: true },
    ]);

    expect(stats).toMatchObject({
      unitsTotal: 2,
      unitsPresent: 1,
      totalMillimes: 1000,
      millimesPresent: 300,
      presentPermille: 300,
      quorumMet: false,
    });
  });

  it('counts a unit represented by proxy toward present millimes', () => {
    // u2 signs in through a proxy owner — its 700‰ count in full.
    const stats = buildAttendanceStats('SIMPLE_MAJORITY', units, [
      { unitId: 'u2', present: true },
    ]);

    expect(stats.unitsPresent).toBe(1);
    expect(stats.millimesPresent).toBe(700);
    expect(stats.presentPermille).toBe(700);
    expect(stats.quorumMet).toBe(true);
  });

  it('applies the stricter line for MILLIMES_MAJORITY votes', () => {
    const atHalf = buildAttendanceStats('MILLIMES_MAJORITY', units, [
      { unitId: 'u1', present: true },
      { unitId: 'u2', present: false },
    ]);
    expect(atHalf.millimesPresent).toBe(300);

    const strictUnits = [
      { id: 'a', millimes: 500 },
      { id: 'b', millimes: 500 },
    ];
    const exactlyHalf = buildAttendanceStats('MILLIMES_MAJORITY', strictUnits, [
      { unitId: 'a', present: true },
    ]);
    expect(exactlyHalf.quorumMet).toBe(false);

    const justOver = buildAttendanceStats('MILLIMES_MAJORITY', strictUnits, [
      { unitId: 'a', present: true },
      { unitId: 'b', present: true },
    ]);
    expect(justOver.quorumMet).toBe(true);
  });

  it('ignores attendance rows for unknown units', () => {
    const stats = buildAttendanceStats('SIMPLE_MAJORITY', units, [
      { unitId: 'ghost', present: true },
    ]);
    expect(stats.unitsPresent).toBe(0);
    expect(stats.millimesPresent).toBe(0);
  });
});

describe('πρακτικό aggregation', () => {
  it('aggregates a closed vote into minutes with per-item decisions', () => {
    const stats = buildAttendanceStats('SIMPLE_MAJORITY', [
      { id: 'u1', millimes: 500 },
      { id: 'u2', millimes: 500 },
    ], [
      { unitId: 'u1', present: true },
      { unitId: 'u2', present: true },
    ]);

    const praktiko = buildPraktiko({
      building: {
        id: 'building-1',
        name: 'Κάτοικος',
        address: 'Εγνατία 42',
        city: 'Thessaloniki',
      },
      vote: {
        id: 'vote-1',
        topic: 'Καθαρισμός ταράτσας',
        description: null,
        thresholdType: 'SIMPLE_MAJORITY',
        opensAt: new Date('2026-01-01T09:00:00Z'),
        closesAt: new Date('2026-01-01T11:00:00Z'),
      },
      agendaItems: [
        { id: 'item-1', position: 1, title: 'Πρόσκληση', body: null },
        { id: 'item-2', position: 2, title: 'Προϋπολογισμός', body: 'Βλέπε παράρτημα' },
      ],
      stats,
      tally: passedTally,
      closed: true,
      generatedAt: new Date('2026-01-01T12:00:00Z'),
    });

    expect(praktiko.vote.closed).toBe(true);
    expect(praktiko.agenda.map((i) => i.title)).toEqual([
      'Πρόσκληση',
      'Προϋπολογισμός',
    ]);
    expect(praktiko.decisions).toHaveLength(2);
    for (const decision of praktiko.decisions) {
      expect(decision.outcome).toBe('PASSED');
      expect(decision.yesCount).toBe(2);
      expect(decision.yesMillimes).toBe(600);
    }
    expect(praktiko.decisions[0].agendaItemId).toBe('item-1');
    expect(praktiko.attendance).toEqual({
      unitsTotal: 2,
      unitsPresent: 2,
      totalMillimes: 1000,
      millimesPresent: 1000,
      presentPermille: 1000,
      quorumMet: true,
    });
    expect(praktiko.generatedAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it('falls back to one decision keyed to the vote topic without agenda', () => {
    const decisions = buildDecisions([], 'Γενικά', passedTally, true);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      agendaItemId: null,
      title: 'Γενικά',
      outcome: 'PASSED',
    });
  });

  it('keeps decisions PENDING while the vote window is still open', () => {
    const decisions = buildDecisions(
      [{ id: 'item-1', title: 'Θέμα 1' }],
      'Θέμα',
      passedTally,
      false,
    );
    expect(decisions[0].outcome).toBe('PENDING');
  });

  describe('AssemblyService.getPraktiko', () => {
    let prisma: ReturnType<typeof makePrisma>;
    let service: AssemblyService;

    beforeEach(() => {
      prisma = makePrisma();
      service = new AssemblyService(
        prisma as unknown as PrismaService,
        makeAudit() as unknown as AuditService,
        realtimeStub(),
      makeLlm() as any,
      );
    });

    it('uses the stored tally of a closed vote without recomputing ballots', async () => {
      prisma.vote.findUnique.mockResolvedValue({
        ...voteRow(),
        result: JSON.stringify(passedTally),
      });
      prisma.agendaItem.findMany.mockResolvedValue([
        { id: 'item-1', position: 1, title: 'Πρόσκληση', body: null },
      ]);
      prisma.unit.findMany.mockResolvedValue([
        { id: 'u1', millimes: 500 },
        { id: 'u2', millimes: 500 },
      ]);
      prisma.attendance.findMany.mockResolvedValue([
        { unitId: 'u1', present: true },
        { unitId: 'u2', present: true },
      ]);

      const praktiko = await service.getPraktiko('vote-1', user);

      expect(prisma.ballot.findMany).not.toHaveBeenCalled();
      expect(praktiko.building.name).toBe('Κάτοικος');
      expect(praktiko.vote.closed).toBe(true);
      expect(praktiko.decisions[0]).toMatchObject({
        agendaItemId: 'item-1',
        title: 'Πρόσκληση',
        outcome: 'PASSED',
      });
      expect(praktiko.attendance.quorumMet).toBe(true);
    });

    it('reports PENDING outcomes while the vote is live', async () => {
      prisma.vote.findUnique.mockResolvedValue(voteRow());
      prisma.unit.findMany.mockResolvedValue([{ id: 'u1', millimes: 1000 }]);
      prisma.attendance.findMany.mockResolvedValue([]);
      prisma.ballot.findMany.mockResolvedValue([
        { unitId: 'u1', choice: 'YES' },
      ]);

      const praktiko = await service.getPraktiko('vote-1', user);

      expect(praktiko.vote.closed).toBe(false);
      expect(praktiko.decisions[0].outcome).toBe('PENDING');
    });

    it('throws NotFound for an unknown vote', async () => {
      prisma.vote.findUnique.mockResolvedValue(null);

      await expect(service.getPraktiko('nope', user)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
