import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ArrearsService } from '../payments/arrears.service';
import { ExportsService } from './exports.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const admin = (): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
});

function makePrisma() {
  return {
    expense: {
      findMany: jest.fn().mockResolvedValue([
        {
          description: 'Αντλία θερμότητας',
          periodYearMonth: '2026-01',
          shares: [
            { unitId: 'u-a', amountCents: 6_000 },
            { unitId: 'u-b', amountCents: 4_000 },
          ],
        },
      ]),
    },
    unit: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'u-a', label: 'Α1' },
          { id: 'u-b', label: 'Β1' },
        ]),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([
        { unitId: 'u-a', periodYearMonth: '2026-01', paidCents: 1_000 },
      ]),
      findUnique: jest.fn().mockResolvedValue({
        id: 'invoice-1',
        buildingId: 'building-1',
        unitId: 'u-a',
        periodYearMonth: '2026-07',
        totalCents: 10_000,
        paidCents: 10_000,
        status: PaymentStatus.PAID,
        payments: [
          {
            createdAt: new Date('2026-07-21T09:00:00.000Z'),
            method: PaymentMethod.CARD,
            pspRef: 'OC-123',
            amountCents: 10_000,
          },
        ],
        unit: { label: 'Α1', building: { name: 'Ηλέκτρα' } },
      }),
    },
    ownership: {
      findFirst: jest.fn().mockResolvedValue({ id: 'own-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('ExportsService.ledgerCsv', () => {
  let service: ExportsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ExportsService(
      prisma as unknown as PrismaService,
      new ArrearsService(prisma as unknown as PrismaService),
    );
  });

  it('renders a BOM-prefixed CSV with rows and a totals footer', async () => {
    const file = await service.ledgerCsv('building-1', '2026', admin());

    expect(file.contentType).toBe('text/csv;charset=utf-8');
    expect(file.filename).toBe('koinoxrista-2026.csv');
    expect(file.body.charCodeAt(0)).toBe(0xfeff);

    const lines = file.body.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'periodYearMonth;unitLabel;description;invoicedCents;paidCents;balanceCents',
    );
    expect(lines[1]).toBe('2026-01;Α1;Αντλία θερμότητας;6000;1000;5000');
    expect(lines[2]).toBe('2026-01;Β1;Αντλία θερμότητας;4000;0;4000');
    expect(lines.at(-1)).toBe('ΣΥΝΟΛΟ;;;10000;1000;9000');

    expect(prisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildingId: 'building-1', periodYearMonth: { startsWith: '2026-' } },
      }),
    );
  });

  it('rejects a missing or malformed year with 400', async () => {
    await expect(service.ledgerCsv('building-1', undefined, admin())).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.ledgerCsv('building-1', '26-01', admin())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('enforces tenant scope', async () => {
    await expect(service.ledgerCsv('building-2', '2026', admin())).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('ExportsService.arrearsCsv', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ExportsService;

  beforeEach(() => {
    prisma = makePrisma();
    prisma.unit.findMany.mockResolvedValue([
      { id: 'u-a', label: 'Α1' },
      { id: 'u-b', label: 'Β1' },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { unitId: 'u-a', periodYearMonth: '2026-08', totalCents: 5_000, paidCents: 0 },
      { unitId: 'u-b', periodYearMonth: '2026-05', totalCents: 9_000, paidCents: 4_000 },
    ]);
    service = new ExportsService(
      prisma as unknown as PrismaService,
      new ArrearsService(prisma as unknown as PrismaService),
    );
  });

  it('exports the arrears report with bucket columns and totals footer', async () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    const file = await service.arrearsCsv('building-1', admin(), now);

    expect(file.filename).toContain('koinoxrista-arrears-2026-08-24');
    const lines = file.body.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toContain('bucket90PlusCents');
    expect(lines[1]).toContain('5000'); // Α1 current bucket
    const footer = lines[lines.length - 1] ?? '';
    const cells = footer.split(';');
    expect(cells[3]).toBe('10000'); // Σ outstanding (5000 + 5000)
    expect(cells[4]).toBe('5000'); // Σ current
    expect(cells[7]).toBe('5000'); // Σ 90+ (Β1 owes 5000 from 2026-05 → monthsBack 3)
  });
});

describe('ExportsService.receiptHtml', () => {
  let service: ExportsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ExportsService(
      prisma as unknown as PrismaService,
      new ArrearsService(prisma as unknown as PrismaService),
    );
  });

  it('returns printable Greek HTML for the building admin', async () => {
    const file = await service.receiptHtml('invoice-1', admin());

    expect(file.contentType).toBe('text/html;charset=utf-8');
    expect(file.filename).toContain('apodeiksi-2026-07');
    expect(file.body).toContain('<html lang="el">');
    expect(file.body).toContain('Ηλέκτρα');
    expect(file.body).toContain('100,00 €');
  });

  it('allows a resident who owns the invoice unit', async () => {
    await expect(
      service.receiptHtml('invoice-1', {
        ...admin(),
        id: 'resident-1',
        role: 'RESIDENT',
      }),
    ).resolves.toBeTruthy();
  });

  it('forbids a resident who does not own the unit', async () => {
    prisma.ownership.findFirst.mockResolvedValue(null);

    await expect(
      service.receiptHtml('invoice-1', {
        ...admin(),
        id: 'resident-2',
        role: 'RESIDENT',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
