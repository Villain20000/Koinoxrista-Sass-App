import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TransferService } from './transfer.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { BUILDING_TRANSFER_VERSION } from '@org/shared';

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

const user = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId: 'building-1',
  ...overrides,
});

const buildingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'building-1',
  name: 'Καθαρά 12',
  address: 'Οδός Καθαράς 12',
  city: 'Thessaloniki',
  ...overrides,
});

type Tx = {
  building: { create: jest.Mock };
  unit: { create: jest.Mock };
  expenseCategory: { create: jest.Mock };
  recurringExpense: { create: jest.Mock };
  budgetLine: { create: jest.Mock };
  complianceItem: { create: jest.Mock };
  ownership: { create: jest.Mock };
  membership: { create: jest.Mock };
  user: { findUnique: jest.Mock };
};

function makePrisma() {
  const tx: Tx = {
    building: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'building-new', ...data }),
        ),
    },
    unit: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: `unit-${data.label}`, ...data }),
        ),
    },
    expenseCategory: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: `cat-${data.name}`, ...data }),
        ),
    },
    recurringExpense: {
      create: jest.fn().mockResolvedValue({}),
    },
    budgetLine: {
      create: jest.fn().mockResolvedValue({}),
    },
    complianceItem: {
      create: jest.fn().mockResolvedValue({}),
    },
    ownership: {
      create: jest.fn().mockResolvedValue({}),
    },
    membership: {
      create: jest.fn().mockResolvedValue({}),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };

  const prisma = {
    building: { findUnique: jest.fn().mockResolvedValue(buildingRow()) },
    unit: { findMany: jest.fn().mockResolvedValue([]) },
    ownership: { findMany: jest.fn().mockResolvedValue([]) },
    expenseCategory: { findMany: jest.fn().mockResolvedValue([]) },
    recurringExpense: { findMany: jest.fn().mockResolvedValue([]) },
    budgetLine: { findMany: jest.fn().mockResolvedValue([]) },
    complianceItem: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(
      (fn: (t: Tx) => Promise<unknown>) => fn(tx) as Promise<unknown>,
    ),
  };

  return { prisma, tx };
}

describe('TransferService.exportBuilding', () => {
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let service: TransferService;

  beforeEach(() => {
    prisma = makePrisma().prisma;
    service = new TransferService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
  });

  it('builds the full payload with owner emails and category names', async () => {
    prisma.unit.findMany.mockResolvedValue([
      {
        label: 'Α1',
        floor: 1,
        millimes: 600,
        radiatorCount: 2,
      },
    ]);
    prisma.ownership.findMany.mockResolvedValue([
      {
        unit: { label: 'Α1' },
        user: { email: 'owner@demo.gr' },
        shareMillimes: 600,
      },
    ]);
    prisma.expenseCategory.findMany.mockResolvedValue([
      { name: 'Θέρμανση', strategy: 'RADIATORS' },
    ]);
    prisma.recurringExpense.findMany.mockResolvedValue([
      {
        name: 'Καθαριότητα',
        amountCents: 12_000,
        strategy: 'MILIMES',
        active: true,
        category: null,
        lastPeriod: '2026-07',
      },
    ]);
    prisma.budgetLine.findMany.mockResolvedValue([
      {
        year: 2026,
        name: 'Ανελκυστήρας',
        plannedCents: 90_000,
        category: { name: 'Λοιπά' },
      },
    ]);
    prisma.complianceItem.findMany.mockResolvedValue([
      {
        kind: 'INSURANCE',
        title: 'Κάλυψη κτιρίου',
        providerName: 'ΑΣΦΑΛΕΙΑ ΑΕ',
        policyNumber: 'P-1',
        premiumCents: 15_000,
        startsOn: new Date('2026-01-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-31T00:00:00.000Z'),
        notes: null,
      },
    ]);

    const payload = await service.exportBuilding('building-1', user());

    expect(payload.version).toBe(BUILDING_TRANSFER_VERSION);
    expect(typeof payload.exportedAt).toBe('string');
    expect(payload.building).toEqual({
      name: 'Καθαρά 12',
      address: 'Οδός Καθαράς 12',
      city: 'Thessaloniki',
    });
    expect(payload.units).toEqual([
      { label: 'Α1', floor: 1, millimes: 600, radiatorCount: 2 },
    ]);
    expect(payload.ownerships).toEqual([
      { unitLabel: 'Α1', email: 'owner@demo.gr', shareMillimes: 600 },
    ]);
    expect(payload.categories).toEqual([
      { name: 'Θέρμανση', strategy: 'RADIATORS' },
    ]);
    expect(payload.recurringExpenses).toEqual([
      {
        name: 'Καθαριότητα',
        amountCents: 12_000,
        strategy: 'MILIMES',
        active: true,
        categoryName: null,
        lastPeriod: '2026-07',
      },
    ]);
    expect(payload.budgetLines).toEqual([
      {
        year: 2026,
        name: 'Ανελκυστήρας',
        plannedCents: 90_000,
        categoryName: 'Λοιπά',
      },
    ]);
    expect(payload.complianceItems).toEqual([
      {
        kind: 'INSURANCE',
        title: 'Κάλυψη κτιρίου',
        providerName: 'ΑΣΦΑΛΕΙΑ ΑΕ',
        policyNumber: 'P-1',
        premiumCents: 15_000,
        startsOn: '2026-01-01T00:00:00.000Z',
        endsOn: '2026-12-31T00:00:00.000Z',
        notes: null,
      },
    ]);
  });

  it('refuses exports for another building', async () => {
    await expect(
      service.exportBuilding('building-other', user()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('404s when the building does not exist', async () => {
    prisma.building.findUnique.mockResolvedValue(null);
    await expect(
      service.exportBuilding('building-1', user()),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('TransferService.importBuilding', () => {
  const validPayload = {
    version: BUILDING_TRANSFER_VERSION,
    exportedAt: '2026-08-25T10:00:00.000Z',
    building: {
      name: 'Νέα Πολυκατοικία',
      address: 'Λεωφόρος 1',
      city: 'Thessaloniki',
    },
    units: [
      { label: 'Α1', floor: 1, millimes: 600, radiatorCount: 2 },
      { label: 'Β1', floor: 2, millimes: 400, radiatorCount: 1 },
    ],
    ownerships: [
      { unitLabel: 'Α1', email: 'owner@demo.gr', shareMillimes: 600 },
      { unitLabel: 'Β1', email: 'ghost@demo.gr', shareMillimes: 400 },
    ],
    categories: [
      { name: 'Θέρμανση', strategy: 'RADIATORS' },
      { name: 'Άγνωστη', strategy: 'NOT_A_STRATEGY' },
    ],
    recurringExpenses: [
      {
        name: 'Καθαριότητα',
        amountCents: 12_000,
        strategy: 'MILIMES',
        active: true,
        categoryName: 'Θέρμανση',
        lastPeriod: '2026-07',
      },
      {
        name: 'Φωτισμός',
        amountCents: 3_000,
        strategy: 'UNITS',
        active: false,
        categoryName: 'Χωρίς κατηγορία',
        lastPeriod: null,
      },
    ],
    budgetLines: [
      {
        year: 2026,
        name: 'Συντήρηση',
        plannedCents: 50_000,
        categoryName: null,
      },
      {
        year: 2026,
        name: 'Ανελκυστήρας',
        plannedCents: 90_000,
        categoryName: 'Χωρίς κατηγορία',
      },
    ],
    complianceItems: [
      {
        kind: 'INSURANCE',
        title: 'Κάλυψη κτιρίου',
        providerName: 'ΑΣΦΑΛΕΙΑ ΑΕ',
        policyNumber: 'P-9',
        premiumCents: 15_000,
        startsOn: '2026-01-01T00:00:00.000Z',
        endsOn: '2026-12-31T00:00:00.000Z',
        notes: 'Καλή κάλυψη',
      },
      {
        kind: 'NOT_A_KIND',
        title: 'Μη έγκυρο',
        providerName: null,
        policyNumber: null,
        premiumCents: null,
        startsOn: '2026-01-01T00:00:00.000Z',
        endsOn: '2026-12-31T00:00:00.000Z',
        notes: null,
      },
      {
        kind: 'FIRE_SAFETY',
        title: 'Κακή ημερομηνία',
        providerName: null,
        policyNumber: null,
        premiumCents: null,
        startsOn: 'not-a-date',
        endsOn: '2026-12-31T00:00:00.000Z',
        notes: null,
      },
    ],
  };

  let tx: ReturnType<typeof makePrisma>['tx'];
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let audit: AuditService;
  let service: TransferService;

  beforeEach(() => {
    ({ prisma, tx } = makePrisma());
    audit = auditStub();
    service = new TransferService(
      prisma as unknown as PrismaService,
      audit,
    );
    // Only owner@demo.gr exists; ghost@demo.gr is unknown.
    tx.user.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        where.email === 'owner@demo.gr'
          ? { id: 'user-owner', email: where.email }
          : null,
      ),
    );
  });

  it('rejects payloads with an unsupported version', async () => {
    await expect(
      service.importBuilding({ version: 99 }, user()),
    ).rejects.toThrow(BadRequestException);
    await expect(service.importBuilding({}, user())).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.importBuilding('nope', user())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('requires a building name', async () => {
    await expect(
      service.importBuilding(
        { ...validPayload, building: { address: '', city: '' } },
        user(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a NEW building with regenerated units and resolved categories', async () => {
    const result = await service.importBuilding(validPayload, user());

    expect(result.buildingId).toBe('building-new');
    expect(result.created.units).toBe(2);
    expect(result.created.categories).toBe(2);

    const unitLabels = tx.unit.create.mock.calls.map(
      ([call]) => call.data.label,
    );
    expect(unitLabels).toEqual(['Α1', 'Β1']);
    expect(tx.unit.create.mock.calls[0][0].data.buildingId).toBe(
      'building-new',
    );

    const categories = tx.expenseCategory.create.mock.calls.map(
      ([call]) => call.data,
    );
    expect(categories[0]).toMatchObject({
      name: 'Θέρμανση',
      strategy: 'RADIATORS',
    });
    // Unknown strategy values are coerced to MILIMES.
    expect(categories[1]).toMatchObject({ name: 'Άγνωστη', strategy: 'MILIMES' });
  });

  it('links recurring templates & budget lines by category name, skipping unresolved ones', async () => {
    const result = await service.importBuilding(validPayload, user());

    const recurring = tx.recurringExpense.create.mock.calls.map(
      ([call]) => call.data,
    );
    expect(recurring).toHaveLength(1);
    expect(recurring[0]).toMatchObject({
      name: 'Καθαριότητα',
      categoryId: 'cat-Θέρμανση',
      lastPeriod: '2026-07',
    });

    const budgets = tx.budgetLine.create.mock.calls.map(([call]) => call.data);
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toMatchObject({
      name: 'Συντήρηση',
      categoryId: null,
    });

    expect(result.created.recurringExpenses).toBe(1);
    expect(result.created.budgetLines).toBe(1);
    expect(result.skipped.recurring).toEqual(['Φωτισμός']);
    expect(result.skipped.budgetLines).toEqual(['Ανελκυστήρας']);
  });

  it('skips compliance items with invalid kinds or dates but imports valid ones', async () => {
    const result = await service.importBuilding(validPayload, user());

    expect(tx.complianceItem.create).toHaveBeenCalledTimes(1);
    const item = tx.complianceItem.create.mock.calls[0][0].data;
    expect(item.title).toBe('Κάλυψη κτιρίου');
    expect(item.startsOn).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(item.endsOn).toEqual(new Date('2026-12-31T00:00:00.000Z'));

    expect(result.skipped.complianceItems).toEqual([
      'Μη έγκυρο',
      'Κακή ημερομηνία',
    ]);
    expect(result.created.complianceItems).toBe(1);
  });

  it('creates ownerships only for existing emails, periodStart = Jan 1 current year', async () => {
    const result = await service.importBuilding(validPayload, user());

    expect(tx.ownership.create).toHaveBeenCalledTimes(1);
    const ownership = tx.ownership.create.mock.calls[0][0].data;
    expect(ownership).toMatchObject({
      userId: 'user-owner',
      shareMillimes: 600,
    });
    const expectedJanFirst = new Date(new Date().getFullYear(), 0, 1);
    expect(ownership.periodStart).toEqual(expectedJanFirst);

    expect(result.created.ownerships).toBe(1);
    expect(result.skipped.ownerships).toEqual(['ghost@demo.gr']);
  });

  it('grants the calling admin a default ADMIN membership and records the audit entry', async () => {
    const result = await service.importBuilding(validPayload, user());

    expect(tx.membership.create).toHaveBeenCalledTimes(1);
    expect(tx.membership.create.mock.calls[0][0].data).toMatchObject({
      userId: 'admin-1',
      buildingId: 'building-new',
      role: 'ADMIN',
      isDefault: true,
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        buildingId: 'building-new',
        actorId: 'admin-1',
        action: 'building.transfer.import',
        entity: 'building',
      }),
    );

    expect(result.created).toEqual({
      units: 2,
      ownerships: 1,
      categories: 2,
      recurringExpenses: 1,
      budgetLines: 1,
      complianceItems: 1,
    });
    expect(result.skipped).toEqual({
      ownerships: ['ghost@demo.gr'],
      recurring: ['Φωτισμός'],
      budgetLines: ['Ανελκυστήρας'],
      complianceItems: ['Μη έγκυρο', 'Κακή ημερομηνία'],
    });
  });
});
