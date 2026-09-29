import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { TreasuryService } from './treasury.service';

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
  const tx = {
    treasuryEntry: {
      create: jest.fn(),
    },
    treasuryAccount: {
      update: jest.fn(),
    },
  };

  return {
    treasuryAccount: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    treasuryEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
    },
    $transaction: jest.fn(async (arg: unknown) => {
      // Support both $transaction([…]) and $transaction(async tx => …)
      if (Array.isArray(arg)) {
        const results = [];
        for (const p of arg) {
          results.push(await p);
        }
        return results;
      }
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(tx);
      }
      return arg;
    }),
    // expose tx for assertions when needed
    __tx: tx,
  };
}

describe('TreasuryService — accounts', () => {
  it('creates an account and returns it with audit', async () => {
    const prisma = makePrisma();
    const audit = auditStub();
    const service = new TreasuryService(prisma as unknown as PrismaService, audit);
    prisma.treasuryAccount.create.mockResolvedValue({
      id: 'acc-1',
      buildingId: 'building-1',
      name: 'Ταμείο',
      type: 'CASH',
      balanceCents: 0,
    });

    const acc = await service.createAccount(
      'building-1',
      { name: 'Ταμείο', type: 'CASH' },
      admin,
    );

    expect(acc).toMatchObject({ name: 'Ταμείο', type: 'CASH' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'treasury.account.created', entity: 'treasury_account' }),
    );
  });

  it('maps P2002 to 409 Conflict on duplicate account name per building', async () => {
    const prisma = makePrisma();
    prisma.treasuryAccount.create.mockRejectedValue({ code: 'P2002' });
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());

    await expect(
      service.createAccount('building-1', { name: 'Ταμείο', type: 'CASH' }, admin),
    ).rejects.toThrow(ConflictException);
  });

  it('enforces tenant isolation on list and create (403)', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());

    await expect(service.listAccounts('building-2', admin)).rejects.toThrow(ForbiddenException);
    await expect(
      service.createAccount('building-2', { name: 'Ταμείο', type: 'CASH' }, admin),
    ).rejects.toThrow(ForbiddenException);
  });

  it('validates account type', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());

    await expect(
      service.createAccount('building-1', { name: 'X', type: 'INVALID' as any }, admin),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('TreasuryService — entries', () => {
  it('creates an entry, updates balance atomically via transaction, and audits', async () => {
    const prisma = makePrisma();
    const audit = auditStub();
    const service = new TreasuryService(prisma as unknown as PrismaService, audit);

    // Account belongs to building-1
    prisma.treasuryAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      buildingId: 'building-1',
      name: 'Ταμείο',
      type: 'CASH',
      balanceCents: 500,
    });

    // Transaction inner fns
    const tx = (prisma as any).__tx;
    tx.treasuryEntry.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'entry-1', ...data, createdAt: new Date('2026-03-10T10:00:00.000Z') }),
    );
    tx.treasuryAccount.update.mockResolvedValue({});

    const entry = await service.createEntry(
      'building-1',
      {
        accountId: 'acc-1',
        amountCents: 1500,
        direction: 'IN',
        method: 'CASH',
        reference: 'Είσπραξη κοινοχρήστων',
      },
      admin,
    );

    expect(entry).toMatchObject({ id: 'entry-1', amountCents: 1500 });
    expect(tx.treasuryEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amountCents: 1500, direction: 'IN' }) }),
    );
    expect(tx.treasuryAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acc-1' },
        data: { balanceCents: { increment: 1500 } },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'treasury.entry.created', entity: 'treasury_entry' }),
    );
    // Verify that findFirst was scoped to building
    expect(prisma.treasuryAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc-1', buildingId: 'building-1' },
    });
  });

  it('handles OUT entries with negative amountCents', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());
    prisma.treasuryAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      buildingId: 'building-1',
      name: 'Τράπεζα Alpha',
      type: 'BANK',
    });
    const tx = (prisma as any).__tx;
    tx.treasuryEntry.create.mockResolvedValue({ id: 'e2', amountCents: -800, direction: 'OUT' });
    tx.treasuryAccount.update.mockResolvedValue({});

    await expect(
      service.createEntry(
        'building-1',
        { accountId: 'acc-1', amountCents: -800, direction: 'OUT', method: 'BANK' },
        admin,
      ),
    ).resolves.toMatchObject({ amountCents: -800 });
    expect(tx.treasuryAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balanceCents: { increment: -800 } } }),
    );
  });

  it('isolates entries per building (404 if account belongs to another building)', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());
    // Account belongs to other building
    prisma.treasuryAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.createEntry(
        'building-1',
        { accountId: 'acc-other-building', amountCents: 1000, direction: 'IN', method: 'CASH' },
        admin,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validates direction/amount sign consistency and zero amount', async () => {
    const prisma = makePrisma();
    prisma.treasuryAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      buildingId: 'building-1',
      type: 'CASH',
    });
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());

    await expect(
      service.createEntry('building-1', { accountId: 'acc-1', amountCents: 0, direction: 'IN', method: 'CASH' }, admin),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createEntry('building-1', { accountId: 'acc-1', amountCents: -500, direction: 'IN', method: 'CASH' }, admin),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createEntry('building-1', { accountId: 'acc-1', amountCents: 500, direction: 'OUT', method: 'CASH' }, admin),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createEntry('building-1', { accountId: 'acc-1', amountCents: 500, direction: 'IN', method: 'INVALID' as any }, admin),
    ).rejects.toThrow(BadRequestException);
  });

  it('forbids cross-building access on listEntries and createEntry', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());

    await expect(service.listEntries('building-2', admin, {})).rejects.toThrow(ForbiddenException);
    await expect(
      service.createEntry('building-2', { accountId: 'acc-1', amountCents: 500, direction: 'IN', method: 'CASH' }, admin),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lists entries with pagination, filters and building-scoped account check', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());

    // account exists in building-1
    prisma.treasuryAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      buildingId: 'building-1',
    });
    // stub transaction array path
    prisma.treasuryEntry.findMany = jest.fn().mockResolvedValue([
      { id: 'e1', amountCents: 100, direction: 'IN', createdAt: new Date('2026-02-01T00:00:00.000Z'), account: { name: 'Ταμείο' } },
    ]);
    prisma.treasuryEntry.count = jest.fn().mockResolvedValue(1);
    // $transaction will await the promises we pass; we already override to resolve them
    // But findMany/count in $transaction are passed as promises; we need them to resolve.
    // Our mock $transaction handles arrays by awaiting each promise.

    const res = await service.listEntries('building-1', admin, {
      accountId: 'acc-1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T00:00:00.000Z',
      skip: '0',
      take: '10',
    });

    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ id: 'e1', accountName: 'Ταμείο' });
  });

  it('rejects invalid date filters', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());
    await expect(service.listEntries('building-1', admin, { from: 'not-a-date' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws 404 when filtering by account not in building', async () => {
    const prisma = makePrisma();
    prisma.treasuryAccount.findFirst.mockResolvedValue(null);
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());
    await expect(service.listEntries('building-1', admin, { accountId: 'foreign-acc' })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('TreasuryService — balance', () => {
  it('aggregates total, cash, bank and monthly IN/OUT totals', async () => {
    const prisma = makePrisma();
    prisma.treasuryAccount.findMany.mockResolvedValue([
      { id: 'acc-cash', name: 'Ταμείο', type: 'CASH', balanceCents: 12000 },
      { id: 'acc-bank', name: 'Τράπεζα Alpha', type: 'BANK', balanceCents: 50000 },
    ]);
    prisma.treasuryEntry.findMany.mockResolvedValue([
      { amountCents: 5000, direction: 'IN', createdAt: new Date('2026-01-15T10:00:00.000Z') },
      { amountCents: -2000, direction: 'OUT', createdAt: new Date('2026-01-20T10:00:00.000Z') },
      { amountCents: 3000, direction: 'IN', createdAt: new Date('2026-02-10T10:00:00.000Z') },
      { amountCents: -1000, direction: 'OUT', createdAt: new Date('2026-02-11T10:00:00.000Z') },
      { amountCents: -500, direction: 'OUT', createdAt: new Date('2026-03-01T10:00:00.000Z') },
    ]);
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());

    const bal = await service.getBalance('building-1', admin);

    expect(bal.totalCents).toBe(62000);
    expect(bal.cashCents).toBe(12000);
    expect(bal.bankCents).toBe(50000);
    expect(bal.byAccount).toHaveLength(2);
    expect(bal.byMonth).toEqual([
      { month: '2026-01', inCents: 5000, outCents: 2000, netCents: 3000 },
      { month: '2026-02', inCents: 3000, outCents: 1000, netCents: 2000 },
      { month: '2026-03', inCents: 0, outCents: 500, netCents: -500 },
    ]);
  });

  it('returns empty buckets for a building with no data', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());

    const bal = await service.getBalance('building-1', admin);
    expect(bal).toEqual({
      totalCents: 0,
      cashCents: 0,
      bankCents: 0,
      byAccount: [],
      byMonth: [],
    });
  });

  it('isolates balance per building', async () => {
    const prisma = makePrisma();
    const service = new TreasuryService(prisma as unknown as PrismaService, auditStub());
    await expect(service.getBalance('building-2', admin)).rejects.toThrow(ForbiddenException);
    // otherAdmin querying own building should pass
    prisma.treasuryAccount.findMany.mockResolvedValue([]);
    prisma.treasuryEntry.findMany.mockResolvedValue([]);
    await expect(service.getBalance('building-2', otherAdmin)).resolves.toEqual(
      expect.objectContaining({ totalCents: 0 }),
    );
  });
});
