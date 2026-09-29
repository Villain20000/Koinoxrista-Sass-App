import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

/** Structural stand-in so specs compile before the shared barrel wiring lands. */
interface InstallmentLike {
  amountCents: number;
}

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentPlansService } from './payment-plans.service';

const auditStub = () => ({ record: jest.fn() }) as unknown as AuditService;

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

const resident: AuthenticatedUser = {
  id: 'resident-1',
  email: 'resident@example.gr',
  role: Role.RESIDENT,
  buildingId: 'building-1',
};

function makePrisma() {
  return {
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    unit: { findFirst: jest.fn().mockResolvedValue(null) },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    ownership: { findMany: jest.fn().mockResolvedValue([]) },
    paymentPlan: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(({ data }) => Promise.resolve({ status: data.status })),
    },
    paymentPlanInstallment: {
      update: jest.fn(({ where, data }) =>
        Promise.resolve({ id: where.id, ...data }),
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
}

type PrismaStub = ReturnType<typeof makePrisma>;

/** Plan row as returned by Prisma include: schedule + unit label. */
function makePlan(
  overrides: Record<string, unknown> = {},
  installments = [
    makeInstallment('inst-1', 1, 5_000),
    makeInstallment('inst-2', 2, 3_000),
    makeInstallment('inst-3', 3, 2_000),
  ],
) {
  return {
    id: 'plan-1',
    buildingId: 'building-1',
    unitId: 'unit-a',
    totalCents: 10_000,
    installmentCount: 3,
    status: 'ACTIVE',
    createdAt: new Date('2026-08-01T09:00:00.000Z'),
    cancelledAt: null,
    unit: { label: 'Α1' },
    installments,
    ...overrides,
  };
}

function makeInstallment(
  id: string,
  seq: number,
  amountCents: number,
  paidCents = 0,
  paidAt: Date | null = null,
) {
  return {
    id,
    planId: 'plan-1',
    seq,
    dueDate: new Date(Date.UTC(2026, 8, seq)),
    amountCents,
    paidCents,
    paidAt,
  };
}

describe('PaymentPlansService.create', () => {
  let prisma: PrismaStub;
  let audit: AuditService;
  let service: PaymentPlansService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new PaymentPlansService(prisma as unknown as PrismaService, audit);
  });

  it('defaults totalCents to the unit invoice arrears and creates the audited schedule', async () => {
    prisma.unit.findFirst.mockResolvedValue({ id: 'unit-a', label: 'Α1' });
    prisma.invoice.findMany.mockResolvedValue([
      { totalCents: 7_000, paidCents: 2_000 },
      { totalCents: 4_000, paidCents: 4_000 }, // settled — ignored
      { totalCents: 1_001, paidCents: 0 },
    ]);
    prisma.paymentPlan.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'plan-new',
        buildingId: 'building-1',
        unitId: data.unitId,
        totalCents: data.totalCents,
        installmentCount: data.installmentCount,
        status: 'ACTIVE',
        createdAt: new Date('2026-08-25T09:00:00.000Z'),
        cancelledAt: null,
        unit: { label: 'Α1' },
        installments: data.installments.create.map((inst: Record<string, unknown>, index: number) => ({
          id: `inst-${index + 1}`,
          planId: 'plan-new',
          paidCents: 0,
          paidAt: null,
          ...inst,
        })),
      }),
    );

    const dto = {
      unitId: 'unit-a',
      installmentCount: 3,
      firstDueDate: '2026-09-01T00:00:00.000Z',
      intervalDays: 30,
    };
    const result = await service.create('building-1', dto, admin);

    // arrears = (7000−2000) + (1001) = 6001 → remainder split to earliest.
    expect(result.totalCents).toBe(6_001);
    expect(
      result.installments?.map((i: InstallmentLike) => i.amountCents),
    ).toEqual([2001, 2000, 2000]);
    expect(result.paidCents).toBe(0);
    expect(result.remainingCents).toBe(6_001);

    const created = prisma.paymentPlan.create.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(created.data.buildingId).toBe('building-1');
    expect(created.data.totalCents).toBe(6_001);
    expect(created.data.status).toBe('ACTIVE');
    expect(prisma.paymentPlanInstallment.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment-plan.create',
        entity: 'payment_plan',
        actorId: 'admin-1',
        metadata: expect.objectContaining({
          unitId: 'unit-a',
          totalCents: 6_001,
          installmentCount: 3,
        }),
      }),
    );
  });

  it('409s when the unit already has an ACTIVE plan (single-plan idempotency)', async () => {
    prisma.unit.findFirst.mockResolvedValue({ id: 'unit-a', label: 'Α1' });
    prisma.paymentPlan.findFirst.mockResolvedValue({ id: 'plan-existing' });

    await expect(
      service.create(
        'building-1',
        {
          unitId: 'unit-a',
          totalCents: 5_000,
          installmentCount: 2,
          firstDueDate: '2026-09-01T00:00:00.000Z',
        },
        admin,
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.paymentPlan.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s an unknown unit and rejects zero arrears when total is defaulted', async () => {
    await expect(
      service.create(
        'building-1',
        {
          unitId: 'missing',
          installmentCount: 2,
          firstDueDate: '2026-09-01T00:00:00.000Z',
        },
        admin,
      ),
    ).rejects.toThrow(NotFoundException);

    prisma.unit.findFirst.mockResolvedValue({ id: 'unit-a', label: 'Α1' });
    prisma.invoice.findMany.mockResolvedValue([
      { totalCents: 1_000, paidCents: 1_000 },
    ]);
    await expect(
      service.create(
        'building-1',
        {
          unitId: 'unit-a',
          installmentCount: 2,
          firstDueDate: '2026-09-01T00:00:00.000Z',
        },
        admin,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.paymentPlan.create).not.toHaveBeenCalled();
  });

  it('forbids creating for another building before any query runs', async () => {
    await expect(
      service.create(
        'building-2',
        {
          unitId: 'unit-a',
          installmentCount: 2,
          firstDueDate: '2026-09-01T00:00:00.000Z',
        },
        admin,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.unit.findFirst).not.toHaveBeenCalled();
  });
});

describe('PaymentPlansService.list/get', () => {
  let prisma: PrismaStub;
  let service: PaymentPlansService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PaymentPlansService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
  });

  it('lists plans newest first with running totals and honors the status filter', async () => {
    prisma.paymentPlan.findMany.mockResolvedValue([
      makePlan(),
      makePlan({ id: 'plan-old', status: 'COMPLETED' }),
    ]);

    const result = await service.list('building-1', admin);
    expect(result[0].paidCents).toBe(0);
    expect(result[0].remainingCents).toBe(10_000);
    expect(result[0].installments).toHaveLength(3);

    await service.list('building-1', admin, 'ACTIVE');
    const call = prisma.paymentPlan.findMany.mock.calls[1][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({ buildingId: 'building-1', status: 'ACTIVE' });

    await expect(service.list('building-1', admin, 'BOGUS')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.list('building-2', admin)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns one plan schedule with running totals and 404s unknown ids', async () => {
    prisma.paymentPlan.findFirst.mockResolvedValue(
      makePlan({}, [
        makeInstallment('inst-1', 1, 5_000, 5_000, new Date('2026-09-02T10:00:00.000Z')),
        makeInstallment('inst-2', 2, 3_000, 1_000),
        makeInstallment('inst-3', 3, 2_000),
      ]),
    );

    const result = await service.get('plan-1', admin);

    expect(result.paidCents).toBe(6_000);
    expect(result.remainingCents).toBe(4_000);
    expect(result.installments?.[1].paidCents).toBe(1_000);
    expect(result.installments?.[1].paidAt).toBeNull();

    prisma.paymentPlan.findFirst.mockResolvedValue(null);
    await expect(service.get('missing', admin)).rejects.toThrow(NotFoundException);

    prisma.paymentPlan.findFirst.mockResolvedValue(makePlan({ buildingId: 'building-2' }));
    await expect(service.get('plan-1', admin)).rejects.toThrow(ForbiddenException);
  });
});

describe('PaymentPlansService.recordPayment', () => {
  let prisma: PrismaStub;
  let audit: AuditService;
  let service: PaymentPlansService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new PaymentPlansService(prisma as unknown as PrismaService, audit);
  });

  it('allocates oldest-first with a partial mid-plan balance and audits the allocations', async () => {
    const before = makePlan();
    const after = makePlan({}, [
      makeInstallment('inst-1', 1, 5_000, 5_000, new Date('2026-08-25T10:00:00.000Z')),
      makeInstallment('inst-2', 2, 3_000, 1_000),
      makeInstallment('inst-3', 3, 2_000),
    ]);
    prisma.paymentPlan.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    const result = await service.recordPayment(
      'plan-1',
      { amountCents: 6_000 },
      admin,
    );

    expect(result.paidCents).toBe(6_000);
    // Only the two touched installments are written — untouched #3 stays put.
    expect(prisma.paymentPlanInstallment.update).toHaveBeenCalledTimes(2);
    expect(prisma.paymentPlanInstallment.update).toHaveBeenCalledWith({
      where: { id: 'inst-1' },
      data: expect.objectContaining({ paidCents: 5_000 }),
    });
    expect(prisma.paymentPlanInstallment.update).toHaveBeenCalledWith({
      where: { id: 'inst-2' },
      data: expect.objectContaining({ paidCents: 1_000 }),
    });
    expect(prisma.paymentPlan.update).not.toHaveBeenCalled(); // not settled yet
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment-plan.payment',
        entity: 'payment_plan',
        entityId: 'plan-1',
        metadata: expect.objectContaining({
          amountCents: 6_000,
          completed: false,
          allocations: [
            { installmentId: 'inst-1', seq: 1, appliedCents: 5_000 },
            { installmentId: 'inst-2', seq: 2, appliedCents: 1_000 },
          ],
        }),
      }),
    );
  });

  it('transitions the plan to COMPLETED inside the settle transaction', async () => {
    const settledAt = new Date('2026-08-20T10:00:00.000Z');
    const before = makePlan({}, [
      makeInstallment('inst-1', 1, 5_000, 5_000, settledAt),
      makeInstallment('inst-2', 2, 3_000, 3_000, settledAt),
      makeInstallment('inst-3', 3, 2_000), // last open balance
    ]);
    const after = makePlan(
      { status: 'COMPLETED' },
      [
        makeInstallment('inst-1', 1, 5_000, 5_000, settledAt),
        makeInstallment('inst-2', 2, 3_000, 3_000, settledAt),
        makeInstallment('inst-3', 3, 2_000, 2_000, new Date('2026-08-25T10:00:00.000Z')),
      ],
    );
    prisma.paymentPlan.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    const result = await service.recordPayment(
      'plan-1',
      { amountCents: 2_000 },
      admin,
    );

    expect(result.status).toBe('COMPLETED');
    // Only the settling installment is written, plus the plan completion.
    expect(prisma.paymentPlanInstallment.update).toHaveBeenCalledTimes(1);
    expect(prisma.paymentPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { status: 'COMPLETED' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = prisma.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(2); // 1 installment + plan completion
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment-plan.payment',
        metadata: expect.objectContaining({ completed: true }),
      }),
    );
  });

  it('rejects overpayments above the remaining balance and non-ACTIVE plans', async () => {
    prisma.paymentPlan.findFirst.mockResolvedValueOnce(makePlan());
    await expect(
      service.recordPayment('plan-1', { amountCents: 10_001 }, admin),
    ).rejects.toThrow(BadRequestException);

    prisma.paymentPlan.findFirst.mockResolvedValueOnce(
      makePlan({ status: 'CANCELLED' }),
    );
    await expect(
      service.recordPayment('plan-1', { amountCents: 100 }, admin),
    ).rejects.toThrow(ConflictException);
    expect(prisma.paymentPlanInstallment.update).not.toHaveBeenCalled();
  });
});

describe('PaymentPlansService.cancel', () => {
  let prisma: PrismaStub;
  let audit: AuditService;
  let service: PaymentPlansService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new PaymentPlansService(prisma as unknown as PrismaService, audit);
  });

  it('removes the unsettled installments, marks CANCELLED and audits what was dropped', async () => {
    const before = makePlan({}, [
      makeInstallment('inst-1', 1, 5_000, 5_000, new Date('2026-09-02T10:00:00.000Z')),
      makeInstallment('inst-2', 2, 3_000),
      makeInstallment('inst-3', 3, 2_000),
    ]);
    const after = makePlan(
      { status: 'CANCELLED', cancelledAt: new Date('2026-08-25T11:00:00.000Z') },
      [makeInstallment('inst-1', 1, 5_000, 5_000, new Date('2026-09-02T10:00:00.000Z'))],
    );
    prisma.paymentPlan.findFirst
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    const result = await service.cancel('plan-1', admin);

    expect(result.status).toBe('CANCELLED');
    expect(result.cancelledAt).toBe('2026-08-25T11:00:00.000Z');
    expect(prisma.paymentPlanInstallment.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['inst-2', 'inst-3'] } },
    });
    expect(prisma.paymentPlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment-plan.cancel',
        entity: 'payment_plan',
        entityId: 'plan-1',
        metadata: expect.objectContaining({
          cancelledCents: 5_000,
          cancelledInstallments: [
            expect.objectContaining({ seq: 2, amountCents: 3_000 }),
            expect.objectContaining({ seq: 3, amountCents: 2_000 }),
          ],
        }),
      }),
    );
  });

  it('refuses to cancel a plan that is not ACTIVE', async () => {
    prisma.paymentPlan.findFirst.mockResolvedValueOnce(
      makePlan({ status: 'COMPLETED' }),
    );
    await expect(service.cancel('plan-1', admin)).rejects.toThrow(ConflictException);
    expect(prisma.paymentPlan.update).not.toHaveBeenCalled();
    expect(prisma.paymentPlanInstallment.deleteMany).not.toHaveBeenCalled();
  });
});

describe('PaymentPlansService.myActivePlan (resident isolation)', () => {
  let prisma: PrismaStub;
  let service: PaymentPlansService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PaymentPlansService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
  });

  it('resolves the plan strictly through the caller ownerships', async () => {
    prisma.ownership.findMany.mockResolvedValue([{ unitId: 'unit-a' }]);
    prisma.paymentPlan.findFirst.mockResolvedValue(makePlan());

    const result = await service.myActivePlan(resident);

    expect(result.unitLabel).toBe('Α1');
    const call = prisma.paymentPlan.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({
      unitId: { in: ['unit-a'] },
      status: 'ACTIVE',
    });
  });

  it('forbids residents without units and 404s when no active plan exists', async () => {
    await expect(service.myActivePlan(resident)).rejects.toThrow(ForbiddenException);

    prisma.ownership.findMany.mockResolvedValue([{ unitId: 'unit-a' }]);
    prisma.paymentPlan.findFirst.mockResolvedValue(null);
    await expect(service.myActivePlan(resident)).rejects.toThrow(NotFoundException);
  });
});
