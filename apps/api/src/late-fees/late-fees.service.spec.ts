import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { LateFeesService } from './late-fees.service';

const auditStub = () => ({ record: jest.fn() }) as unknown as AuditService;

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

function makePrisma() {
  return {
    lateFeeSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    lateFeeCharge: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

/** Invoice for period `2026-06` is due at 2026-07-01T00:00Z. */
function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    buildingId: 'building-1',
    unitId: 'unit-a',
    periodYearMonth: '2026-06',
    totalCents: 10_000,
    paidCents: 0,
    status: PaymentStatus.PENDING,
    unit: { label: 'Α1' },
    ...overrides,
  };
}

/** Fixed "now" well past the June 2026 due moment. */
const NOW = new Date('2026-07-21T12:00:00.000Z');

describe('LateFeesService.run', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;
  let service: LateFeesService;
  let dateNowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new LateFeesService(prisma as unknown as PrismaService, audit);
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });

  afterEach(() => dateNowSpy.mockRestore());

  it('charges unpaid overdue invoices beyond grace with FLAT rates and audits', async () => {
    prisma.lateFeeSetting.findUnique.mockResolvedValue({
      graceDays: 5,
      mode: 'FLAT',
      dailyFlatCents: 200,
      dailyBps: 0,
      capCents: null,
    });
    // Due 2026-07-01 → 20 overdue days as of NOW → chargeable days = 15.
    prisma.invoice.findMany.mockResolvedValue([
      makeInvoice({ id: 'inv-a', unitId: 'unit-a' }),
      makeInvoice({ id: 'inv-b', unitId: 'unit-b', paidCents: 10_000 }), // settled
      makeInvoice({ id: 'inv-c', unitId: 'unit-c', paidCents: 4_000 }), // partial
    ]);
    prisma.lateFeeCharge.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `charge-${data.unitId}`, ...data }),
    );

    await expect(
      service.run('building-1', {}, admin),
    ).resolves.toEqual({ charged: 2, totalCents: 200 * 15 * 2 });

    const createCallForA = prisma.lateFeeCharge.create.mock.calls.find(
      ([{ data }]) => data.unitId === 'unit-a',
    );
    expect(createCallForA).toBeDefined();
    const createdA = (createCallForA?.[0] ?? { data: {} }) as {
      data: Record<string, unknown>;
    };
    expect(createdA.data).toMatchObject({
      buildingId: 'building-1',
      invoiceId: 'inv-a',
      month: '2026-06',
      daysLate: 15,
      amountCents: 3_000,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'late-fee.run',
        entity: 'late_fee_charge',
        actorId: 'admin-1',
        metadata: expect.objectContaining({ charged: 2, totalCents: 6_000 }),
      }),
    );
  });

  it('is idempotent: a second run creates zero new charges', async () => {
    prisma.lateFeeSetting.findUnique.mockResolvedValue({
      graceDays: 5,
      mode: 'FLAT',
      dailyFlatCents: 200,
      dailyBps: 0,
      capCents: null,
    });
    prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);

    // First sweep charges the unit…
    prisma.lateFeeCharge.create.mockResolvedValue({
      id: 'charge-1',
      buildingId: 'building-1',
      unitId: 'unit-a',
      month: '2026-06',
      daysLate: 15,
      amountCents: 3_000,
    });
    await expect(
      service.run('building-1', {}, admin),
    ).resolves.toEqual({ charged: 1, totalCents: 3_000 });

    // …so a second run sees the existing (unitId, month) pair and no-ops.
    prisma.lateFeeCharge.findMany.mockResolvedValue([
      { unitId: 'unit-a', month: '2026-06' },
    ]);
    await expect(
      service.run('building-1', {}, admin),
    ).resolves.toEqual({ charged: 0, totalCents: 0 });
    expect(prisma.lateFeeCharge.create).toHaveBeenCalledTimes(1);
  });

  it('skips invoices inside the grace window and computes PERCENT accruals', async () => {
    prisma.lateFeeSetting.findUnique.mockResolvedValue({
      graceDays: 5,
      mode: 'PERCENT',
      dailyFlatCents: 0,
      dailyBps: 50,
      capCents: null,
    });
    // July 2026 invoice: due Aug 1 → negative overdue days.
    prisma.invoice.findMany.mockResolvedValue([
      makeInvoice({ periodYearMonth: '2026-07', unitId: 'unit-in-grace' }),
      makeInvoice({ unitId: 'unit-percent' }),
    ]);

    await service.run('building-1', {}, admin);

    const created = prisma.lateFeeCharge.create.mock.calls[0][0] as {
      data: { daysLate: number; amountCents: number };
    };
    expect(created.data.daysLate).toBe(15);
    // round(10000 × 50bps /10000 × 15) = 750
    expect(created.data.amountCents).toBe(750);
    expect(prisma.lateFeeCharge.create).toHaveBeenCalledTimes(1);
  });

  it('applies the cap to a single charge', async () => {
    prisma.lateFeeSetting.findUnique.mockResolvedValue({
      graceDays: 5,
      mode: 'FLAT',
      dailyFlatCents: 5_000,
      dailyBps: 0,
      capCents: 4_000,
    });
    prisma.invoice.findMany.mockResolvedValue([makeInvoice()]);

    await expect(
      service.run('building-1', {}, admin),
    ).resolves.toEqual({ charged: 1, totalCents: 4_000 });
  });

  it('scopes the sweep to the requested month and validates its format', async () => {
    prisma.lateFeeSetting.findUnique.mockResolvedValue(null); // defaults
    prisma.invoice.findMany.mockResolvedValue([]);

    await service.run('building-1', { month: '2026-06' }, admin);

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          buildingId: 'building-1',
          status: { not: 'PAID' },
          periodYearMonth: '2026-06',
        }),
      }),
    );

    await expect(
      service.run('building-1', { month: '06-2026' }, admin),
    ).rejects.toThrow(BadRequestException);
  });

  it('forbids running for another building', async () => {
    await expect(service.run('building-2', {}, admin)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe('LateFeesService.getSettings/updateSettings', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: LateFeesService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new LateFeesService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
  });

  it('returns built-in defaults when never configured', async () => {
    await expect(service.getSettings('building-1', admin)).resolves.toEqual({
      buildingId: 'building-1',
      graceDays: 5,
      mode: 'FLAT',
      dailyFlatCents: 0,
      dailyBps: 0,
      capCents: null,
    });
  });

  it('upserts merged settings and maps updatedAt to ISO', async () => {
    prisma.lateFeeSetting.findUnique.mockResolvedValue(null);
    const updatedAt = new Date('2026-07-20T08:00:00.000Z');
    prisma.lateFeeSetting.upsert.mockImplementation(({ create }) =>
      Promise.resolve({ ...create, updatedAt }),
    );

    await expect(
      service.updateSettings(
        'building-1',
        { graceDays: 10, mode: 'PERCENT', dailyBps: 75, capCents: 9_900 },
        admin,
      ),
    ).resolves.toEqual({
      buildingId: 'building-1',
      graceDays: 10,
      mode: 'PERCENT',
      dailyFlatCents: 0,
      dailyBps: 75,
      capCents: 9_900,
      updatedAt: updatedAt.toISOString(),
    });
  });

  it('rejects settings without a usable rate for the chosen mode', async () => {
    await expect(
      service.updateSettings('building-1', { graceDays: 3 }, admin),
    ).rejects.toThrow(BadRequestException);

    prisma.lateFeeSetting.findUnique.mockResolvedValue({
      graceDays: 5,
      mode: 'FLAT',
      dailyFlatCents: 200,
      dailyBps: 0,
      capCents: null,
    });
    await expect(
      service.updateSettings('building-1', { mode: 'PERCENT' }, admin),
    ).rejects.toThrow(BadRequestException);
  });

  it('clears the cap when null is sent', async () => {
    prisma.lateFeeSetting.findUnique.mockResolvedValue({
      graceDays: 5,
      mode: 'FLAT',
      dailyFlatCents: 200,
      dailyBps: 0,
      capCents: 5_000,
    });
    prisma.lateFeeSetting.upsert.mockImplementation(({ update }) =>
      Promise.resolve({
        graceDays: 5,
        mode: 'FLAT',
        dailyFlatCents: 200,
        dailyBps: 0,
        capCents: null,
        updatedAt: new Date(),
        ...update,
      }),
    );

    await expect(
      service.updateSettings('building-1', { capCents: null }, admin),
    ).resolves.toMatchObject({ capCents: null });
  });
});

describe('LateFeesService.list/waive', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;
  let service: LateFeesService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new LateFeesService(prisma as unknown as PrismaService, audit);
  });

  function makeCharge(overrides: Record<string, unknown> = {}) {
    return {
      id: 'charge-1',
      buildingId: 'building-1',
      unitId: 'unit-a',
      invoiceId: 'inv-1',
      month: '2026-06',
      daysLate: 15,
      amountCents: 3_000,
      waivedAt: null,
      createdAt: new Date('2026-07-21T09:00:00.000Z'),
      unit: { label: 'Α1' },
      ...overrides,
    };
  }

  it('lists charges with unit labels, newest first', async () => {
    prisma.lateFeeCharge.findMany.mockResolvedValue([
      makeCharge(),
      makeCharge({
        id: 'charge-older',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        waivedAt: new Date('2026-07-02T00:00:00.000Z'),
      }),
    ]);

    await expect(service.list('building-1', admin)).resolves.toEqual([
      expect.objectContaining({
        id: 'charge-1',
        unitLabel: 'Α1',
        waivedAt: null,
        createdAt: '2026-07-21T09:00:00.000Z',
      }),
      expect.objectContaining({
        id: 'charge-older',
        waivedAt: '2026-07-02T00:00:00.000Z',
      }),
    ]);
    const call = prisma.lateFeeCharge.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('waives an active charge once and audits it', async () => {
    prisma.lateFeeCharge.findFirst.mockResolvedValue(makeCharge());

    const result = await service.waive('charge-1', admin);

    expect(result.waivedAt).not.toBeNull();
    expect(prisma.lateFeeCharge.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'charge-1' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'late-fee.waive',
        entity: 'late_fee_charge',
        entityId: 'charge-1',
      }),
    );
  });

  it('is idempotent on already-waived charges', async () => {
    prisma.lateFeeCharge.findFirst.mockResolvedValue(
      makeCharge({ waivedAt: new Date('2026-07-02T00:00:00.000Z') }),
    );

    const result = await service.waive('charge-1', admin);

    expect(result.waivedAt).toBe('2026-07-02T00:00:00.000Z');
    expect(prisma.lateFeeCharge.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s unknown charges and forbids other buildings', async () => {
    await expect(service.waive('missing', admin)).rejects.toThrow(
      NotFoundException,
    );

    prisma.lateFeeCharge.findFirst.mockResolvedValue(
      makeCharge({ buildingId: 'building-2' }),
    );
    await expect(service.waive('charge-1', admin)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.lateFeeCharge.update).not.toHaveBeenCalled();
  });
});
