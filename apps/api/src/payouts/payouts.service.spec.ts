import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, SupplierPaymentMethod } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { PayoutsService } from './payouts.service';

const auditStub = () => ({ record: jest.fn() }) as unknown as AuditService;

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

const provider: AuthenticatedUser = {
  id: 'provider-1',
  email: 'provider@example.gr',
  role: Role.PROVIDER,
  buildingId: null,
};

function makePrisma() {
  return {
    supplierPayment: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    job: { findFirst: jest.fn().mockResolvedValue(null) },
    expense: { findFirst: jest.fn().mockResolvedValue(null) },
  };
}

const paidAt = new Date('2026-03-10T10:00:00.000Z');

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sp-1',
    buildingId: 'building-1',
    jobId: 'job-1',
    expenseId: null,
    amountCents: 15_000,
    method: SupplierPaymentMethod.BANK,
    paidAt,
    reference: 'TR-001',
    notes: null,
    createdAt: paidAt,
    job: { title: 'Αντικατάσταση αντλίας' },
    expense: null,
    ...overrides,
  };
}

describe('PayoutsService.list', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: PayoutsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PayoutsService(prisma as unknown as PrismaService, auditStub());
  });

  it('maps rows to views with job/expense labels, newest first', async () => {
    prisma.supplierPayment.findMany.mockResolvedValue([
      makePayment(),
      makePayment({
        id: 'sp-2',
        jobId: null,
        expenseId: 'exp-1',
        job: null,
        expense: { description: 'Καθαρισμός' },
        amountCents: 8_000,
      }),
    ]);

    await expect(service.list('building-1', admin)).resolves.toEqual([
      expect.objectContaining({
        id: 'sp-1',
        jobTitle: 'Αντικατάσταση αντλίας',
        expenseDescription: null,
      }),
      {
        id: 'sp-2',
        buildingId: 'building-1',
        jobId: null,
        expenseId: 'exp-1',
        amountCents: 8_000,
        method: 'BANK',
        paidAt: paidAt.toISOString(),
        reference: 'TR-001',
        notes: null,
        jobTitle: null,
        expenseDescription: 'Καθαρισμός',
        createdAt: paidAt.toISOString(),
      },
    ]);
    const call = prisma.supplierPayment.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ paidAt: 'desc' });
    expect(call.where).toEqual({ buildingId: 'building-1' });
  });

  it('narrows the query by year and jobId when given', async () => {
    prisma.supplierPayment.findMany.mockResolvedValue([]);
    await service.list('building-1', admin, 2025, 'job-9');

    const call = prisma.supplierPayment.findMany.mock.calls[0][0];
    expect(call.where.jobId).toBe('job-9');
    expect((call.where.paidAt.gte as Date).toISOString()).toBe(
      '2025-01-01T00:00:00.000Z',
    );
    expect((call.where.paidAt.lt as Date).toISOString()).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('forbids access to another building', async () => {
    await expect(service.list('building-2', admin)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('PayoutsService.create', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;
  let service: PayoutsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new PayoutsService(prisma as unknown as PrismaService, audit);
  });

  it('creates the payment with createdById and writes an audit entry', async () => {
    prisma.job.findFirst.mockResolvedValue({ id: 'job-1', buildingId: 'building-1' });
    prisma.supplierPayment.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'sp-new', ...data }),
    );

    await expect(
      service.create(
        'building-1',
        {
          amountCents: 25_000,
          method: SupplierPaymentMethod.CASH,
          paidAt: '2026-04-01T09:00:00.000Z',
          jobId: 'job-1',
          reference: 'Αποδεικτικό #12',
        },
        admin,
      ),
    ).resolves.toMatchObject({ id: 'sp-new', createdById: 'admin-1' });

    expect(prisma.supplierPayment.create.mock.calls[0][0].data).toMatchObject({
      buildingId: 'building-1',
      amountCents: 25_000,
      method: 'CASH',
      jobId: 'job-1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'supplier-payment.create',
        entity: 'supplier_payment',
        entityId: 'sp-new',
        actorId: 'admin-1',
      }),
    );
  });

  it('404s when the linked job belongs to another building', async () => {
    await expect(
      service.create(
        'building-1',
        {
          amountCents: 1_000,
          method: SupplierPaymentMethod.BANK,
          paidAt: '2026-04-01T09:00:00.000Z',
          jobId: 'job-other-building',
        },
        admin,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.supplierPayment.create).not.toHaveBeenCalled();
  });

  it('404s when the linked expense does not exist in the building', async () => {
    await expect(
      service.create(
        'building-1',
        {
          amountCents: 1_000,
          method: SupplierPaymentMethod.BANK,
          paidAt: '2026-04-01T09:00:00.000Z',
          expenseId: 'exp-missing',
        },
        admin,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('PayoutsService.update/remove tenancy', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: PayoutsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PayoutsService(prisma as unknown as PrismaService, auditStub());
  });

  it('404s when the payment belongs to another building', async () => {
    await expect(
      service.update(
        'building-1',
        'sp-foreign',
        { amountCents: 99 },
        admin,
      ),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.remove('building-1', 'sp-foreign', admin),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.supplierPayment.delete).not.toHaveBeenCalled();
  });

  it('updates only provided fields of an owned payment', async () => {
    prisma.supplierPayment.findFirst.mockResolvedValue(makePayment());
    prisma.supplierPayment.update.mockImplementation(({ data }) =>
      Promise.resolve(makePayment(data)),
    );

    await service.update('building-1', 'sp-1', { reference: 'Νέο παραστατικό' }, admin);

    expect(prisma.supplierPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sp-1' },
        data: { reference: 'Νέο παραστατικό' },
      }),
    );
  });

  it('deletes an owned payment and records the audit trail', async () => {
    prisma.supplierPayment.findFirst.mockResolvedValue(makePayment());
    const audit = auditStub();
    const owned = new PayoutsService(
      prisma as unknown as PrismaService,
      audit,
    );

    await owned.remove('building-1', 'sp-1', admin);

    expect(prisma.supplierPayment.delete).toHaveBeenCalledWith({
      where: { id: 'sp-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'supplier-payment.delete' }),
    );
  });
});

describe('PayoutsService.summary', () => {
  it('aggregates totals per method and month for the requested year', async () => {
    const prisma = makePrisma();
    prisma.supplierPayment.findMany.mockResolvedValue([
      { amountCents: 10_000, method: SupplierPaymentMethod.BANK, paidAt: new Date('2026-01-15T00:00:00.000Z') },
      { amountCents: 5_500, method: SupplierPaymentMethod.CASH, paidAt: new Date('2026-01-20T00:00:00.000Z') },
      { amountCents: 7_000, method: SupplierPaymentMethod.CASH, paidAt: new Date('2026-03-02T00:00:00.000Z') },
      { amountCents: 999, method: SupplierPaymentMethod.BANK, paidAt: new Date('2025-12-31T23:59:59.999Z') },
    ]);
    const service = new PayoutsService(prisma as unknown as PrismaService, auditStub());

    await expect(service.summary('building-1', admin, 2026)).resolves.toEqual({
      totalCents: 22_500,
      byMethod: [
        { method: 'CASH', totalCents: 12_500 },
        { method: 'BANK', totalCents: 10_000 },
      ],
      byMonth: [
        { month: '2026-01', totalCents: 15_500 },
        { month: '2026-03', totalCents: 7_000 },
      ],
    });

    const where = prisma.supplierPayment.findMany.mock.calls[0][0].where;
    expect((where.paidAt.gte as Date).getUTCFullYear()).toBe(2026);
  });

  it('defaults to the current UTC year and returns empty buckets', async () => {
    const prisma = makePrisma();
    prisma.supplierPayment.findMany.mockResolvedValue([]);
    const service = new PayoutsService(prisma as unknown as PrismaService, auditStub());

    await expect(service.summary('building-1', admin)).resolves.toEqual({
      totalCents: 0,
      byMethod: [],
      byMonth: [],
    });
  });
});

describe('PayoutsService.mine', () => {
  it('lists payments on jobs with the caller ACCEPTED bid, newest first', async () => {
    const prisma = makePrisma();
    prisma.supplierPayment.findMany.mockResolvedValue([
      makePayment({ id: 'sp-latest' }),
      makePayment({
        id: 'sp-older',
        paidAt: new Date('2026-01-05T00:00:00.000Z'),
      }),
    ]);
    const service = new PayoutsService(prisma as unknown as PrismaService, auditStub());

    await expect(service.mine(provider)).resolves.toEqual([
      {
        id: 'sp-latest',
        jobTitle: 'Αντικατάσταση αντλίας',
        amountCents: 15_000,
        method: 'BANK',
        paidAt: paidAt.toISOString(),
        reference: 'TR-001',
      },
      {
        id: 'sp-older',
        jobTitle: 'Αντικατάσταση αντλίας',
        amountCents: 15_000,
        method: 'BANK',
        paidAt: '2026-01-05T00:00:00.000Z',
        reference: 'TR-001',
      },
    ]);

    const call = prisma.supplierPayment.findMany.mock.calls[0][0];
    expect(call.where.job.bids.some).toEqual({
      providerUserId: 'provider-1',
      status: 'ACCEPTED',
    });
    expect(call.orderBy).toEqual({ paidAt: 'desc' });
  });
});
