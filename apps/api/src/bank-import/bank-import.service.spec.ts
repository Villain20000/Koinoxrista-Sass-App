import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentOrderState,
  PaymentStatus,
} from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BankImportService } from './bank-import.service';

const CSV = '2026-08-03;100,00;ΔΟΣΗ Α1\n2026-08-04;50.00;pay-2\n';

const adminUser: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
};

function makePrisma() {
  const tx = {
    payment: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    invoice: {
      update: jest.fn().mockResolvedValue({}),
    },
    paymentOrder: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return {
    tx,
    payment: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
}

const auditStub = () => ({ record: jest.fn() }) as unknown as AuditService;

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    amountCents: 10_000,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    invoice: {
      periodYearMonth: '2026-07',
      unit: { label: 'Α1' },
    },
    ...overrides,
  };
}

describe('BankImportService.preview', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: BankImportService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new BankImportService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
  });

  it('maps PENDING building payments into options and suggests matches', async () => {
    prisma.payment.findMany.mockResolvedValue([
      pendingRow({ id: 'pay-1', amountCents: 10_000 }),
      pendingRow({
        id: 'pay-2',
        amountCents: 5_000,
        invoice: { periodYearMonth: '2026-07', unit: { label: 'Β2' } },
      }),
    ]);

    await expect(
      service.preview('building-1', adminUser, CSV),
    ).resolves.toEqual({
      rows: [
        { dateIso: '2026-08-03', amountCents: 10_000, reference: 'ΔΟΣΗ Α1' },
        { dateIso: '2026-08-04', amountCents: 5_000, reference: 'pay-2' },
      ],
      pending: [
        {
          paymentId: 'pay-1',
          amountCents: 10_000,
          invoicePeriodYearMonth: '2026-07',
          createdAtIso: '2026-08-01T10:00:00.000Z',
          unitLabel: 'Α1',
        },
        {
          paymentId: 'pay-2',
          amountCents: 5_000,
          invoicePeriodYearMonth: '2026-07',
          createdAtIso: '2026-08-01T10:00:00.000Z',
          unitLabel: 'Β2',
        },
      ],
      suggestions: [
        { rowIndex: 0, paymentId: 'pay-1', confidence: 'high' },
        { rowIndex: 1, paymentId: 'pay-2', confidence: 'high' },
      ],
    });
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: PaymentStatus.PENDING, invoice: { buildingId: 'building-1' } },
      }),
    );
  });

  it('rejects a user from another building', async () => {
    const outsider: AuthenticatedUser = {
      ...adminUser,
      buildingId: 'building-9',
    };
    await expect(
      service.preview('building-1', outsider, CSV),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('BankImportService.apply', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: BankImportService;
  let audit: ReturnType<typeof auditStub>;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new BankImportService(
      prisma as unknown as PrismaService,
      audit,
    );
  });

  it('settles a matched payment like the Viva webhook and counts it applied', async () => {
    prisma.tx.payment.findUnique.mockResolvedValue({
      id: 'pay-2',
      amountCents: 5_000,
      status: PaymentStatus.PENDING,
      invoice: {
        id: 'invoice-2',
        buildingId: 'building-1',
        totalCents: 20_000,
        paidCents: 15_000,
      },
    });

    await expect(
      service.apply('building-1', adminUser, {
        csv: CSV,
        matches: [{ rowIndex: 1, paymentId: 'pay-2' }],
      }),
    ).resolves.toEqual({ applied: 1, skipped: 0 });

    expect(prisma.tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-2' },
      data: {
        method: PaymentMethod.IRIS,
        status: PaymentStatus.PAID,
        pspRef: 'pay-2',
      },
    });
    expect(prisma.tx.invoice.update).toHaveBeenCalledWith({
      where: { id: 'invoice-2' },
      data: {
        paidCents: { increment: 5_000 },
        status: PaymentStatus.PAID,
      },
    });
    expect(prisma.tx.paymentOrder.updateMany).toHaveBeenCalledWith({
      where: { invoiceId: 'invoice-2', status: PaymentOrderState.PENDING },
      data: { status: PaymentOrderState.COMPLETED },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.bank-import', entityId: 'pay-2' }),
    );
  });

  it('keeps the invoice PENDING when the bank credit only partially settles it', async () => {
    prisma.tx.payment.findUnique.mockResolvedValue({
      id: 'pay-2',
      amountCents: 5_000,
      status: PaymentStatus.PENDING,
      invoice: {
        id: 'invoice-2',
        buildingId: 'building-1',
        totalCents: 30_000,
        paidCents: 0,
      },
    });

    await service.apply('building-1', adminUser, {
      csv: CSV,
      matches: [{ rowIndex: 1, paymentId: 'pay-2' }],
    });

    expect(prisma.tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: PaymentStatus.PENDING }),
      }),
    );
  });

  it('is idempotent — already-PAID payments are skipped without writes', async () => {
    prisma.tx.payment.findUnique.mockResolvedValue({
      id: 'pay-2',
      amountCents: 5_000,
      status: PaymentStatus.PAID,
      invoice: {
        id: 'invoice-2',
        buildingId: 'building-1',
        totalCents: 20_000,
        paidCents: 20_000,
      },
    });

    await expect(
      service.apply('building-1', adminUser, {
        csv: CSV,
        matches: [{ rowIndex: 1, paymentId: 'pay-2' }],
      }),
    ).resolves.toEqual({ applied: 0, skipped: 1 });

    expect(prisma.tx.payment.update).not.toHaveBeenCalled();
    expect(prisma.tx.invoice.update).not.toHaveBeenCalled();
  });

  it('skips duplicates of the same payment inside one request', async () => {
    prisma.tx.payment.findUnique.mockImplementation(({ where }) =>
      Promise.resolve({
        id: where.id,
        amountCents: 5_000,
        status:
          where.id === 'pay-2-done' ? PaymentStatus.PAID : PaymentStatus.PENDING,
        invoice: {
          id: 'invoice-2',
          buildingId: 'building-1',
          totalCents: 20_000,
          paidCents: 0,
        },
      }),
    );

    await expect(
      service.apply('building-1', adminUser, {
        csv: CSV,
        matches: [
          { rowIndex: 1, paymentId: 'pay-2-done' },
          { rowIndex: 1, paymentId: 'pay-2-done' },
        ],
      }),
    ).resolves.toEqual({ applied: 0, skipped: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects payments that do not belong to the building', async () => {
    prisma.tx.payment.findUnique.mockResolvedValue({
      id: 'pay-x',
      amountCents: 5_000,
      status: PaymentStatus.PENDING,
      invoice: {
        id: 'invoice-x',
        buildingId: 'building-99',
        totalCents: 20_000,
        paidCents: 0,
      },
    });

    await expect(
      service.apply('building-1', adminUser, {
        csv: CSV,
        matches: [{ rowIndex: 0, paymentId: 'pay-x' }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.tx.payment.update).not.toHaveBeenCalled();
  });

  it('rejects match entries pointing past the parsed statement rows', async () => {
    await expect(
      service.apply('building-1', adminUser, {
        csv: CSV,
        matches: [{ rowIndex: 42, paymentId: 'pay-2' }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
