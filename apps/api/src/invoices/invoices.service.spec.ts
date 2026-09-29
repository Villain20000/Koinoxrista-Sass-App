import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from './invoices.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

const notificationsStub = (): NotificationsService =>
  ({
    create: jest.fn(),
    createForUsers: jest.fn(),
  }) as unknown as NotificationsService;

const user = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId: 'building-1',
  ...overrides,
});

function makePrisma() {
  return {
    building: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'building-1',
        units: [
          { id: 'unit-a', label: 'Α1', millimes: 600 },
          { id: 'unit-b', label: 'Β1', millimes: 400 },
        ],
      }),
    },
    expense: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest
        .fn()
        .mockImplementation(async (args: { create: object }) => args.create ?? {}),
    },
    ownership: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
}

describe('InvoicesService', () => {
  let service: InvoicesService;
  let prisma: ReturnType<typeof makePrisma>;
  let notifications: NotificationsService;

  beforeEach(() => {
    prisma = makePrisma();
    notifications = notificationsStub();
    service = new InvoicesService(
      prisma as unknown as PrismaService,
      auditStub(),
      notifications,
    );
  });

  it('rejects an invalid period', async () => {
    await expect(
      service.run('building-1', { periodYearMonth: '09-2026' }, user()),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a building whose unit millimes do not total 1000', async () => {
    prisma.building.findUnique.mockResolvedValue({
      id: 'building-1',
      units: [{ id: 'unit-a', millimes: 500 }],
    });

    await expect(
      service.run('building-1', { periodYearMonth: '2026-08' }, user()),
    ).rejects.toThrow(/millimes must total 1000/);
  });

  it('rejects the run when there are no expenses for the period', async () => {
    prisma.expense.findMany.mockResolvedValue([]);

    await expect(
      service.run('building-1', { periodYearMonth: '2026-08' }, user()),
    ).rejects.toThrow(new BadRequestException('no expenses for period'));
  });

  it('aggregates expenses across categories into one invoice per unit', async () => {
    prisma.expense.findMany.mockResolvedValue([
      { shares: [{ unitId: 'unit-a', amountCents: 600 }, { unitId: 'unit-b', amountCents: 400 }] },
      { shares: [{ unitId: 'unit-a', amountCents: 25 }] },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { unitId: 'unit-a', paidCents: 0 },
      { unitId: 'unit-b', paidCents: 0 },
    ]);

    await service.run('building-1', { periodYearMonth: '2026-08' }, user());

    const upserts = prisma.invoice.upsert.mock.calls.map((c) => c[0]);
    const byUnit = new Map(upserts.map((u) => [u.where.unitId_periodYearMonth.unitId, u]));
    expect(byUnit.get('unit-a').create.totalCents).toBe(625);
    expect(byUnit.get('unit-a').update.status).toBe(PaymentStatus.PENDING);
    expect(byUnit.get('unit-b').create.totalCents).toBe(400);
  });

  it('preserves paidCents and keeps PAID invoices paid on re-run', async () => {
    prisma.expense.findMany.mockResolvedValue([
      { shares: [{ unitId: 'unit-a', amountCents: 625 }, { unitId: 'unit-b', amountCents: 375 }] },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { unitId: 'unit-a', paidCents: 625 },
      { unitId: 'unit-b', paidCents: 100 },
    ]);

    await service.run('building-1', { periodYearMonth: '2026-08' }, user());

    const upserts = prisma.invoice.upsert.mock.calls.map((c) => c[0]);
    const byUnit = new Map(upserts.map((u) => [u.where.unitId_periodYearMonth.unitId, u]));
    expect(byUnit.get('unit-a').update).toEqual({
      totalCents: 625,
      status: PaymentStatus.PAID,
    });
    expect(byUnit.get('unit-b').update.status).toBe(PaymentStatus.PENDING);
    expect(JSON.stringify(byUnit.get('unit-a').update)).not.toContain('paidCents');
  });

  it('notifies each distinct unit owner exactly once after a successful run', async () => {
    prisma.expense.findMany.mockResolvedValue([
      { shares: [{ unitId: 'unit-a', amountCents: 600 }, { unitId: 'unit-b', amountCents: 400 }] },
    ]);
    prisma.ownership.findMany.mockResolvedValue([
      { userId: 'owner-1' },
      { userId: 'owner-2' },
    ]);

    await service.run('building-1', { periodYearMonth: '2026-08' }, user());

    expect(prisma.ownership.findMany).toHaveBeenCalledWith({
      where: { unit: { buildingId: 'building-1' } },
      select: { userId: true },
      distinct: ['userId'],
    });
    expect(notifications.createForUsers).toHaveBeenCalledWith(
      ['owner-1', 'owner-2'],
      {
        type: 'invoice.issued',
        title: 'Νέο κοινοχρήστους λόγος',
        linkPath: '/balance',
        sms: { kind: 'invoice.issued', periodKey: '2026-08' },
      },
    );
  });

  it('enforces tenant scope', async () => {
    await expect(
      service.listAdmin('building-2', undefined, user()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('resolves my invoices through my ownerships, newest period first', async () => {
    prisma.ownership.findMany.mockResolvedValue([
      { unitId: 'unit-a' },
      { unitId: 'unit-b' },
    ]);
    prisma.invoice.findMany.mockResolvedValue([]);

    await service.findMine('2026-07', user({ role: 'RESIDENT', id: 'resident-1' }));

    expect(prisma.ownership.findMany).toHaveBeenCalledWith({
      where: { userId: 'resident-1' },
      select: { unitId: true },
    });
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { unitId: { in: ['unit-a', 'unit-b'] }, periodYearMonth: '2026-07' },
        orderBy: { periodYearMonth: 'desc' },
      }),
    );
  });
});
