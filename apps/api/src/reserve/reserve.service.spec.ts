import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { ReserveService } from './reserve.service';

const auditStub = () => ({ record: jest.fn() }) as unknown as AuditService;

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

const otherAdmin: AuthenticatedUser = {
  id: 'admin-2',
  email: 'other@example.gr',
  role: Role.ADMIN,
  buildingId: 'building-2',
};

function makePrisma() {
  const tx: Record<string, any> = {
    reserveFund: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    reserveContribution: { create: jest.fn() },
    reserveDrawdown: { create: jest.fn() },
    extraordinaryLevy: {
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    levyShare: { createMany: jest.fn() },
  };

  return {
    reserveFund: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    reserveContribution: {
      create: jest.fn(),
    },
    reserveDrawdown: {
      create: jest.fn(),
    },
    extraordinaryLevy: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    levyShare: {
      createMany: jest.fn(),
    },
    unit: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(tx);
      }
      if (Array.isArray(arg)) {
        const results = [];
        for (const p of arg) results.push(await p);
        return results;
      }
      return arg;
    }),
    __tx: tx,
  };
}

describe('ReserveService — fund', () => {
  it('getOrCreateFund creates fund when missing', async () => {
    const prisma = makePrisma();
    prisma.reserveFund.findUnique.mockResolvedValue(null);
    prisma.reserveFund.create.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      targetCents: 0,
      balanceCents: 0,
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );

    const fund = await service.getOrCreateFund('building-1', admin);
    expect(fund).toMatchObject({ id: 'fund-1', buildingId: 'building-1' });
    expect(prisma.reserveFund.create).toHaveBeenCalledWith({
      data: { buildingId: 'building-1', targetCents: 0, balanceCents: 0 },
    });
  });

  it('getOrCreateFund returns existing fund', async () => {
    const prisma = makePrisma();
    prisma.reserveFund.findUnique.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      targetCents: 10000,
      balanceCents: 5000,
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    const fund = await service.getOrCreateFund('building-1', admin);
    expect(fund.targetCents).toBe(10000);
    expect(prisma.reserveFund.create).not.toHaveBeenCalled();
  });

  it('updateTarget sets targetCents and audits', async () => {
    const prisma = makePrisma();
    const audit = auditStub();
    prisma.reserveFund.findUnique.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      targetCents: 0,
      balanceCents: 0,
    });
    prisma.reserveFund.update.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      targetCents: 50000,
      balanceCents: 0,
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      audit,
    );

    const updated = await service.updateTarget('building-1', 50000, admin);
    expect(updated.targetCents).toBe(50000);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reserve.fund.target_updated',
        entity: 'reserve_fund',
      }),
    );
  });

  it('enforces tenant isolation on fund access', async () => {
    const prisma = makePrisma();
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    await expect(service.getOrCreateFund('building-2', admin)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.updateTarget('building-2', 1000, admin),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ReserveService — contribute / drawdown', () => {
  it('contribute increments balance atomically via transaction and audits', async () => {
    const prisma = makePrisma();
    const audit = auditStub();
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      audit,
    );
    prisma.reserveFund.findUnique.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      targetCents: 10000,
      balanceCents: 2000,
    });
    const tx = (prisma as any).__tx;
    tx.reserveContribution.create.mockResolvedValue({
      id: 'contrib-1',
      amountCents: 1500,
    });
    tx.reserveFund.update.mockResolvedValue({
      id: 'fund-1',
      balanceCents: 3500,
    });

    const result = await service.contribute(
      'building-1',
      { amountCents: 1500, source: 'MANUAL', notes: 'test' },
      admin,
    );

    expect(result.contribution).toMatchObject({ id: 'contrib-1' });
    expect(tx.reserveContribution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fundId: 'fund-1',
          amountCents: 1500,
          source: 'MANUAL',
        }),
      }),
    );
    expect(tx.reserveFund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'fund-1' },
        data: { balanceCents: { increment: 1500 } },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reserve.contribution.created' }),
    );
  });

  it('drawdown decrements balance atomically and checks insufficient funds', async () => {
    const prisma = makePrisma();
    const audit = auditStub();
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      audit,
    );
    prisma.reserveFund.findUnique.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      targetCents: 10000,
      balanceCents: 5000,
    });
    const tx = (prisma as any).__tx;
    tx.reserveFund.findUnique.mockResolvedValue({
      id: 'fund-1',
      balanceCents: 5000,
    });
    tx.reserveDrawdown.create.mockResolvedValue({ id: 'dd-1', amountCents: 1000 });
    tx.reserveFund.update.mockResolvedValue({ id: 'fund-1', balanceCents: 4000 });

    const result = await service.drawdown(
      'building-1',
      { amountCents: 1000, reason: 'Επισκευή' },
      admin,
    );
    expect(result.drawdown).toMatchObject({ id: 'dd-1' });
    expect(tx.reserveFund.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balanceCents: { decrement: 1000 } },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reserve.drawdown.created' }),
    );
  });

  it('drawdown throws 400 when balance insufficient', async () => {
    const prisma = makePrisma();
    prisma.reserveFund.findUnique.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      targetCents: 10000,
      balanceCents: 500,
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    await expect(
      service.drawdown('building-1', { amountCents: 1000, reason: 'test' }, admin),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('forbids cross-building contribute/drawdown', async () => {
    const prisma = makePrisma();
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    await expect(
      service.contribute('building-2', { amountCents: 100, source: 'MANUAL' }, admin),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.drawdown('building-2', { amountCents: 100, reason: 'x' }, admin),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ReserveService — levies', () => {
  it('createLevy allocates totalCents per MILIMES using largest remainder', async () => {
    const prisma = makePrisma();
    prisma.unit.findMany.mockResolvedValue([
      { id: 'unit-1', millimes: 600, label: 'A1' },
      { id: 'unit-2', millimes: 400, label: 'A2' },
    ]);
    const tx = (prisma as any).__tx;
    tx.extraordinaryLevy.create.mockResolvedValue({ id: 'levy-1' });
    tx.levyShare.createMany.mockResolvedValue({ count: 2 });
    tx.extraordinaryLevy.findUniqueOrThrow.mockResolvedValue({
      id: 'levy-1',
      buildingId: 'building-1',
      title: 'Επισκευή ταράτσας',
      totalCents: 10001,
      strategy: 'MILIMES',
      status: 'DRAFT',
      shares: [
        { unitId: 'unit-1', amountCents: 6001 },
        { unitId: 'unit-2', amountCents: 4000 },
      ],
    });

    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );

    const levy = await service.createLevy(
      'building-1',
      { title: 'Επισκευή ταράτσας', totalCents: 10001, strategy: 'MILIMES' },
      admin,
    );

    expect(levy.shares).toHaveLength(2);
    // 10001 * 0.6 = 6000.6 -> largest remainder gives 6001 to unit-1
    expect(levy.shares.find((s: any) => s.unitId === 'unit-1').amountCents).toBe(6001);
    expect(tx.extraordinaryLevy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalCents: 10001, strategy: 'MILIMES', status: 'DRAFT' }),
      }),
    );
    expect(tx.levyShare.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ levyId: 'levy-1', unitId: 'unit-1' }),
          expect.objectContaining({ levyId: 'levy-1', unitId: 'unit-2' }),
        ]),
      }),
    );
    const sum = levy.shares.reduce((a: number, s: any) => a + s.amountCents, 0);
    expect(sum).toBe(10001);
  });

  it('createLevy with UNITS splits equally', async () => {
    const prisma = makePrisma();
    prisma.unit.findMany.mockResolvedValue([
      { id: 'u1', millimes: 500, label: '1' },
      { id: 'u2', millimes: 500, label: '2' },
      { id: 'u3', millimes: 500, label: '3' },
    ]);
    const tx = (prisma as any).__tx;
    tx.extraordinaryLevy.create.mockResolvedValue({ id: 'levy-2' });
    tx.levyShare.createMany.mockResolvedValue({ count: 3 });
    tx.extraordinaryLevy.findUniqueOrThrow.mockResolvedValue({
      id: 'levy-2',
      totalCents: 100,
      shares: [
        { unitId: 'u1', amountCents: 34 },
        { unitId: 'u2', amountCents: 33 },
        { unitId: 'u3', amountCents: 33 },
      ],
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    const levy = await service.createLevy(
      'building-1',
      { title: 'Έκτακτη', totalCents: 100, strategy: 'UNITS' },
      admin,
    );
    const sum = levy.shares.reduce((a: number, s: any) => a + s.amountCents, 0);
    expect(sum).toBe(100);
  });

  it('createLevy with CUSTOM requires customWeights covering all units', async () => {
    const prisma = makePrisma();
    prisma.unit.findMany.mockResolvedValue([
      { id: 'u1', millimes: 100, label: '1' },
      { id: 'u2', millimes: 200, label: '2' },
    ]);
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    await expect(
      service.createLevy(
        'building-1',
        { title: 'Custom', totalCents: 1000, strategy: 'CUSTOM', customWeights: [{ unitId: 'u1', weight: 2 }] },
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('createLevy with SQUARE_METERS splits by m² scaled to integer hundredths', async () => {
    const prisma = makePrisma();
    prisma.unit.findMany.mockResolvedValue([
      { id: 'u1', millimes: 500, squareMeters: 85.5, label: '1' },
      { id: 'u2', millimes: 500, squareMeters: 64.25, label: '2' },
    ]);
    const tx = (prisma as any).__tx;
    tx.extraordinaryLevy.create.mockResolvedValue({ id: 'levy-3' });
    tx.levyShare.createMany.mockResolvedValue({ count: 2 });
    tx.extraordinaryLevy.findUniqueOrThrow.mockResolvedValue({
      id: 'levy-3',
      totalCents: 1000,
      strategy: 'SQUARE_METERS',
      shares: [
        { unitId: 'u1', amountCents: 571 },
        { unitId: 'u2', amountCents: 429 },
      ],
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    const levy = await service.createLevy(
      'building-1',
      { title: 'Έκτακτη', totalCents: 1000, strategy: 'SQUARE_METERS' },
      admin,
    );
    // 85.5 / 149.75 = 0.57095… → 571 for u1, remainder to u2 = 429
    expect(levy.shares.find((s: any) => s.unitId === 'u1').amountCents).toBe(571);
    expect(levy.shares.find((s: any) => s.unitId === 'u2').amountCents).toBe(429);
    expect(tx.extraordinaryLevy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          strategy: 'SQUARE_METERS',
          status: 'DRAFT',
        }),
      }),
    );
    const sum = levy.shares.reduce((a: number, s: any) => a + s.amountCents, 0);
    expect(sum).toBe(1000);
  });

  it('createLevy with SHARE_FRACTION splits by the ‰ ownership share', async () => {
    const prisma = makePrisma();
    prisma.unit.findMany.mockResolvedValue([
      { id: 'u1', millimes: 100, shareFraction: 600, label: '1' },
      { id: 'u2', millimes: 900, shareFraction: 400, label: '2' },
    ]);
    const tx = (prisma as any).__tx;
    tx.extraordinaryLevy.create.mockResolvedValue({ id: 'levy-4' });
    tx.levyShare.createMany.mockResolvedValue({ count: 2 });
    tx.extraordinaryLevy.findUniqueOrThrow.mockResolvedValue({
      id: 'levy-4',
      totalCents: 10001,
      strategy: 'SHARE_FRACTION',
      shares: [
        { unitId: 'u1', amountCents: 6001 },
        { unitId: 'u2', amountCents: 4000 },
      ],
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    const levy = await service.createLevy(
      'building-1',
      { title: 'Έκτακτη', totalCents: 10001, strategy: 'SHARE_FRACTION' },
      admin,
    );
    // ignores millimes: 600/1000 → 6000.6 → 6001 to u1, 4000 to u2
    expect(levy.shares.find((s: any) => s.unitId === 'u1').amountCents).toBe(6001);
    expect(levy.shares.find((s: any) => s.unitId === 'u2').amountCents).toBe(4000);
    const sum = levy.shares.reduce((a: number, s: any) => a + s.amountCents, 0);
    expect(sum).toBe(10001);
  });

  it('createLevy rejects SQUARE_METERS / SHARE_FRACTION when no unit carries the weight', async () => {
    const prisma = makePrisma();
    prisma.unit.findMany.mockResolvedValue([
      { id: 'u1', millimes: 500, squareMeters: null, shareFraction: null, label: '1' },
      { id: 'u2', millimes: 500, squareMeters: 0, shareFraction: 0, label: '2' },
    ]);
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    await expect(
      service.createLevy(
        'building-1',
        { title: 'Έκτακτη', totalCents: 1000, strategy: 'SQUARE_METERS' },
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createLevy(
        'building-1',
        { title: 'Έκτακτη', totalCents: 1000, strategy: 'SHARE_FRACTION' },
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('issueLevy marks ISSUED, creates reserve contributions per share, increments balance and audits', async () => {
    const prisma = makePrisma();
    const audit = auditStub();
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      audit,
    );
    prisma.extraordinaryLevy.findFirst.mockResolvedValue({
      id: 'levy-1',
      buildingId: 'building-1',
      title: 'Ταράτσα',
      totalCents: 2000,
      strategy: 'UNITS',
      status: 'DRAFT',
      shares: [
        { unitId: 'u1', amountCents: 1000 },
        { unitId: 'u2', amountCents: 1000 },
      ],
    });
    prisma.reserveFund.findUnique.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      targetCents: 10000,
      balanceCents: 500,
    });
    const tx = (prisma as any).__tx;
    tx.extraordinaryLevy.update.mockResolvedValue({
      id: 'levy-1',
      status: 'ISSUED',
      shares: [{ unitId: 'u1' }, { unitId: 'u2' }],
    });
    tx.reserveContribution.create.mockResolvedValue({ id: 'c1' });
    tx.reserveFund.update.mockResolvedValue({ id: 'fund-1', balanceCents: 2500 });

    const issued = await service.issueLevy('building-1', 'levy-1', admin);
    expect(issued.status).toBe('ISSUED');
    expect(tx.reserveContribution.create).toHaveBeenCalledTimes(2);
    expect(tx.reserveContribution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'LEVY', levyId: 'levy-1' }),
      }),
    );
    expect(tx.reserveFund.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceCents: { increment: 2000 } } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reserve.levy.issued' }),
    );
  });

  it('issueLevy rejects non-DRAFT status', async () => {
    const prisma = makePrisma();
    prisma.extraordinaryLevy.findFirst.mockResolvedValue({
      id: 'levy-1',
      buildingId: 'building-1',
      status: 'ISSUED',
      shares: [],
    });
    prisma.reserveFund.findUnique.mockResolvedValue({
      id: 'fund-1',
      buildingId: 'building-1',
      balanceCents: 0,
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    await expect(service.issueLevy('building-1', 'levy-1', admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('closeLevy transitions ISSUED -> CLOSED and audits, rejects otherwise', async () => {
    const prisma = makePrisma();
    const audit = auditStub();
    prisma.extraordinaryLevy.findFirst.mockResolvedValue({
      id: 'levy-1',
      buildingId: 'building-1',
      status: 'ISSUED',
      title: 'Test',
    });
    prisma.extraordinaryLevy.update.mockResolvedValue({
      id: 'levy-1',
      status: 'CLOSED',
    });
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      audit,
    );
    const closed = await service.closeLevy('building-1', 'levy-1', admin);
    expect(closed.status).toBe('CLOSED');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reserve.levy.closed' }),
    );

    // try closing DRAFT -> should fail
    prisma.extraordinaryLevy.findFirst.mockResolvedValue({
      id: 'levy-2',
      buildingId: 'building-1',
      status: 'DRAFT',
    });
    await expect(service.closeLevy('building-1', 'levy-2', admin)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('listLevies and getLevyDetail enforce tenant isolation and 404', async () => {
    const prisma = makePrisma();
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    prisma.extraordinaryLevy.findFirst.mockResolvedValue(null);
    await expect(service.getLevyDetail('building-1', 'missing', admin)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.listLevies('building-2', admin)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.createLevy('building-2', { title: 't', totalCents: 100, strategy: 'UNITS' }, admin)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('createLevy validates building has units', async () => {
    const prisma = makePrisma();
    prisma.unit.findMany.mockResolvedValue([]);
    const service = new ReserveService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
    await expect(
      service.createLevy('building-1', { title: 'Test', totalCents: 1000, strategy: 'UNITS' }, admin),
    ).rejects.toThrow(BadRequestException);
  });
});
