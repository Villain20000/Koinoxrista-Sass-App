import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { OcrService } from './ocr.service';
import { MyDataPullService } from './mydata-pull.service';

const user = { id: 'admin-1', email: 'a@b.gr', role: Role.ADMIN, buildingId: 'building-1' } as any;
const foreignUser = { id: 'admin-9', email: 'x@b.gr', role: Role.ADMIN, buildingId: 'building-9' } as any;

function sampleInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    buildingId: 'building-1',
    issuerName: 'ΔΕΗ Α.Ε.',
    issuerAfm: '094162110',
    issueDate: new Date('2026-08-10T00:00:00.000Z'),
    netCents: 10000,
    vatCents: 2400,
    totalCents: 12400,
    currency: 'EUR',
    mydataMark: null,
    classification: 'category1_1',
    status: 'DRAFT',
    rawJson: null,
    pdfUrl: null,
    expenseId: null,
    createdAt: new Date('2026-08-10T12:00:00.000Z'),
    ...overrides,
  };
}

function makePrisma() {
  const tx = {
    expense: { create: jest.fn().mockResolvedValue({ id: 'exp-1' }) },
    share: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    supplierInvoice: { update: jest.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, ...data })) },
  };
  return {
    supplierInvoice: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'inv-new', createdAt: new Date(), ...data })),
      update: jest.fn().mockImplementation(({ where, data }: any) => Promise.resolve({ id: where.id, buildingId: 'building-1', issuerName: 'X', issueDate: new Date(), netCents: 10000, vatCents: 2400, totalCents: 12400, currency: 'EUR', status: 'DRAFT', createdAt: new Date(), ...data })),
      count: jest.fn().mockResolvedValue(0),
    },
    expense: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'exp-1' }),
    },
    expenseCategory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cat-1', buildingId: 'building-1', strategy: 'MILIMES' }),
      create: jest.fn().mockResolvedValue({ id: 'cat-new', buildingId: 'building-1' }),
    },
    unit: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'unit-a', label: 'A1', millimes: 600 },
        { id: 'unit-b', label: 'B1', millimes: 400 },
      ]),
    },
    share: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    $transaction: jest.fn(async (arg: any) => {
      if (Array.isArray(arg)) {
        // handle list pagination $transaction([findMany, count])
        const [findManyResult, countResult] = await Promise.all(arg.map((p: any) => p));
        return [findManyResult, countResult];
      }
      if (typeof arg === 'function') {
        return arg(tx);
      }
      return arg;
    }),
    _tx: tx,
  };
}

describe('SupplierInvoicesService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { record: jest.Mock };
  let ocr: OcrService;
  let pull: MyDataPullService;
  let service: SupplierInvoicesService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = { record: jest.fn() };
    ocr = new OcrService();
    pull = new MyDataPullService();
    jest.spyOn(pull, 'pullForBuilding').mockResolvedValue([]);
    service = new SupplierInvoicesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      ocr,
      pull,
    );
  });

  describe('list', () => {
    it('scopes to building, filters by status and date range, paginates', async () => {
      prisma.supplierInvoice.findMany = jest.fn().mockResolvedValue([sampleInvoice()]);
      prisma.supplierInvoice.count = jest.fn().mockResolvedValue(1);
      // need to mock $transaction to forward to findMany/count correctly for this test
      prisma.$transaction = jest.fn(async (args: any) => {
        if (Array.isArray(args)) {
          const [fm, cnt] = args;
          const items = await fm;
          const total = await cnt;
          return [items, total];
        }
        return args;
      }) as any;

      const result = await service.list(
        'building-1',
        { status: 'DRAFT', from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z', skip: '0', take: '10' },
        user,
      );

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      // Verify where clause constructed via prisma call
      const findManyCall = (prisma.supplierInvoice.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.buildingId).toBe('building-1');
      expect(findManyCall.where.status).toBe('DRAFT');
      expect(findManyCall.where.issueDate.gte.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(findManyCall.skip).toBe(0);
      expect(findManyCall.take).toBe(10);
    });

    it('rejects foreign building and invalid status', async () => {
      await expect(service.list('building-9', {}, user)).rejects.toThrow(ForbiddenException);
      await expect(service.list('building-1', { status: 'INVALID' } as any, user)).rejects.toThrow(BadRequestException);
    });

    it('rejects from > to', async () => {
      await expect(
        service.list('building-1', { from: '2026-09-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' }, user),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('importManual', () => {
    it('creates DRAFT with tenant scoping and audit', async () => {
      prisma.supplierInvoice.create.mockResolvedValue(
        sampleInvoice({ id: 'new-1', status: 'DRAFT', issuerName: 'ΕΥΔΑΠ', netCents: 5000, vatCents: 1200, totalCents: 6200 }),
      );
      const dto = {
        issuerName: 'ΕΥΔΑΠ Α.Ε.',
        issuerAfm: '094079589',
        issueDate: '2026-08-12',
        netCents: 5000,
        vatCents: 1200,
        totalCents: 6200,
        classification: 'category1_2',
      };
      const result = await service.importManual('building-1', dto as any, user);
      expect(result.issuerName).toBe('ΕΥΔΑΠ');
      expect(prisma.supplierInvoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          issuerName: 'ΕΥΔΑΠ Α.Ε.',
          issueDate: new Date('2026-08-12'),
          netCents: 5000,
          vatCents: 1200,
          totalCents: 6200,
          status: 'DRAFT',
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'supplier_invoice.manual_created' }));
    });

    it('rejects total mismatch and foreign building', async () => {
      await expect(
        service.importManual(
          'building-1',
          { issuerName: 'X', issueDate: '2026-08-12', netCents: 10000, vatCents: 2400, totalCents: 9999 } as any,
          user,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.importManual('building-9', { issuerName: 'X', issueDate: '2026-08-12', netCents: 100, vatCents: 24, totalCents: 124 } as any, user),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('importFromJson', () => {
    it('parses myDATA JSON, creates IMPORTED, handles nested json wrapper', async () => {
      prisma.supplierInvoice.findFirst.mockResolvedValue(null);
      prisma.supplierInvoice.create.mockResolvedValue(
        sampleInvoice({ id: 'imp-1', status: 'IMPORTED', mydataMark: 'MARK-001', issuerName: 'ΔΕΗ Α.Ε.' }),
      );
      const body = {
        json: {
          issuerName: 'ΔΕΗ Α.Ε.',
          issuerAfm: '094162110',
          issueDate: '2026-08-10',
          netValue: 100.0,
          vatAmount: 24.0,
          total: 124.0,
          mark: 'MARK-001',
          classification: 'category1_1',
        },
      };
      const result = await service.importFromJson('building-1', body as any, user);
      expect(result.status).toBe('IMPORTED');
      expect(result.mydataMark).toBe('MARK-001');
      expect(prisma.supplierInvoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          issuerName: 'ΔΕΗ Α.Ε.',
          status: 'IMPORTED',
          mydataMark: 'MARK-001',
          netCents: 10000,
          vatCents: 2400,
          totalCents: 12400,
        }),
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'supplier_invoice.imported_json' }));
    });

    it('derives missing amounts and dedupes by mark idempotently', async () => {
      const existing = sampleInvoice({ id: 'existing', mydataMark: 'MARK-DUP', status: 'IMPORTED' });
      prisma.supplierInvoice.findFirst.mockResolvedValueOnce(existing);
      // second call for duplicate should return existing
      const body = {
        issuerName: 'ΔΕΗ',
        issueDate: '2026-08-10',
        netCents: 10000,
        vatCents: 2400,
        totalCents: 12400,
        mydataMark: 'MARK-DUP',
      };
      const result = await service.importFromJson('building-1', body as any, user);
      expect(result.id).toBe('existing');
      expect(prisma.supplierInvoice.create).not.toHaveBeenCalled();
    });

    it('rejects invalid JSON envelope and missing required fields', async () => {
      await expect(service.importFromJson('building-1', null as any, user)).rejects.toThrow(BadRequestException);
      await expect(service.importFromJson('building-1', { issueDate: '2026-08-10' } as any, user)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('handles total-only JSON by splitting net/vat 24%', async () => {
      prisma.supplierInvoice.findFirst.mockResolvedValue(null);
      prisma.supplierInvoice.create.mockResolvedValue(sampleInvoice({ status: 'IMPORTED' }));
      const body = {
        issuerName: 'Test',
        issueDate: '2026-08-10',
        totalCents: 12400,
      };
      await service.importFromJson('building-1', body as any, user);
      const createArg = (prisma.supplierInvoice.create as jest.Mock).mock.calls[0][0].data;
      expect(createArg.netCents + createArg.vatCents).toBe(12400);
      // 12400 /1.24 = 10000 net
      expect(createArg.netCents).toBe(10000);
    });
  });

  describe('importFromPdf', () => {
    it('uses OCR stub to extract amounts and creates DRAFT with confidence', async () => {
      const fakeText = OcrService.buildFakeInvoiceText({
        issuerName: 'Καθαρισμός Α.Ε.',
        issuerAfm: '123456789',
        issueDate: '2026-08-15',
        netCents: 8000,
        vatCents: 1920,
        totalCents: 9920,
      });
      const buffer = Buffer.from(fakeText, 'utf8');
      prisma.supplierInvoice.create.mockResolvedValue(
        sampleInvoice({ id: 'pdf-1', status: 'DRAFT', issuerName: 'Καθαρισμός Α.Ε.' }),
      );
      const result = await service.importFromPdf(
        'building-1',
        { buffer, originalname: 'invoice.pdf', mimetype: 'application/pdf', size: buffer.length },
        user,
      );
      expect(result.status).toBe('DRAFT');
      expect(prisma.supplierInvoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          status: 'DRAFT',
          pdfUrl: expect.stringContaining('supplier-invoices/building-1'),
        }),
      });
      // confidence should be reflected in audit metadata
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'supplier_invoice.imported_pdf' }));
      expect((result as any).ocrConfidence).toBeGreaterThan(50);
    });

    it('throws when file missing and respects tenant', async () => {
      await expect(service.importFromPdf('building-1', undefined, user)).rejects.toThrow(BadRequestException);
      await expect(
        service.importFromPdf('building-9', { buffer: Buffer.from('test'), originalname: 'x.pdf', mimetype: 'application/pdf', size: 4 } as any, user),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('pullFromMyData', () => {
    it('fetches external invoices, dedupes by mark, audits', async () => {
      const fakeExternal = [
        {
          issuerName: 'ΔΕΗ Α.Ε.',
          issuerAfm: '094162110',
          issueDate: '2026-08-10',
          netCents: 10000,
          vatCents: 2400,
          totalCents: 12400,
          mydataMark: 'MARK-001',
          classification: 'category1_1',
          rawJson: { mark: 'MARK-001' },
        },
        {
          issuerName: 'ΕΥΔΑΠ',
          issuerAfm: '094079589',
          issueDate: '2026-08-11',
          netCents: 5000,
          vatCents: 1200,
          totalCents: 6200,
          mydataMark: 'MARK-002',
          rawJson: {},
        },
      ];
      jest.spyOn(pull, 'pullForBuilding').mockResolvedValue(fakeExternal as any);
      // First mark already exists
      prisma.supplierInvoice.findFirst
        .mockResolvedValueOnce({ id: 'existing', mydataMark: 'MARK-001' } as any)
        .mockResolvedValueOnce(null);
      prisma.supplierInvoice.create.mockResolvedValue(sampleInvoice({ id: 'new', mydataMark: 'MARK-002', status: 'IMPORTED' }));

      const res = await service.pullFromMyData('building-1', user);
      expect(res).toEqual({ imported: 1, skipped: 1, total: 2 });
      expect(prisma.supplierInvoice.create).toHaveBeenCalledTimes(1);
      expect(prisma.supplierInvoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ mydataMark: 'MARK-002', status: 'IMPORTED' }),
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'supplier_invoice.pull_mydata' }));
    });

    it('returns zeros when external is empty and respects tenant', async () => {
      jest.spyOn(pull, 'pullForBuilding').mockResolvedValue([]);
      await expect(service.pullFromMyData('building-1', user)).resolves.toEqual({ imported: 0, skipped: 0, total: 0 });
      await expect(service.pullFromMyData('building-9', user)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('matchToExpense', () => {
    it('auto-creates Expense via largest-remainder and links invoice to MATCHED', async () => {
      const invoice = sampleInvoice({ id: 'inv-1', status: 'DRAFT', totalCents: 12400, expenseId: null });
      prisma.supplierInvoice.findFirst.mockResolvedValue(invoice);
      prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1', buildingId: 'building-1', strategy: 'MILIMES' });
      prisma.unit.findMany.mockResolvedValue([
        { id: 'unit-a', millimes: 600 },
        { id: 'unit-b', millimes: 400 },
      ]);

      const result = await service.matchToExpense('building-1', 'inv-1', undefined, user);
      // Should have created expense with splits 7440/4960 for 12400 total 60/40
      const txCreate = prisma._tx.expense.create;
      expect(txCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          totalCents: 12400,
        }),
      });
      const shareData = prisma._tx.share.createMany.mock.calls[0][0].data as Array<{ unitId: string; amountCents: number }>;
      expect(shareData.reduce((s, x) => s + x.amountCents, 0)).toBe(12400);
      expect(shareData).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ unitId: 'unit-a', amountCents: 7440 }),
          expect.objectContaining({ unitId: 'unit-b', amountCents: 4960 }),
        ]),
      );
      expect(prisma._tx.supplierInvoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { expenseId: 'exp-1', status: 'MATCHED' },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'supplier_invoice.matched' }));
    });

    it('links to existing expense when expenseId provided', async () => {
      const invoice = sampleInvoice({ id: 'inv-2', status: 'IMPORTED', expenseId: null });
      prisma.supplierInvoice.findFirst.mockResolvedValue(invoice);
      prisma.expense.findFirst = jest.fn().mockResolvedValue({ id: 'exp-99', buildingId: 'building-1' });
      prisma.supplierInvoice.update = jest.fn().mockResolvedValue(sampleInvoice({ id: 'inv-2', status: 'MATCHED', expenseId: 'exp-99' }));

      const res = await service.matchToExpense('building-1', 'inv-2', 'exp-99', user);
      expect(res.status).toBe('MATCHED');
      expect(prisma.supplierInvoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-2' },
        data: { expenseId: 'exp-99', status: 'MATCHED' },
      });
    });

    it('rejects already matched, voided, or foreign invoice', async () => {
      prisma.supplierInvoice.findFirst.mockResolvedValue(sampleInvoice({ status: 'MATCHED' }));
      await expect(service.matchToExpense('building-1', 'inv-1', undefined, user)).rejects.toThrow(BadRequestException);

      prisma.supplierInvoice.findFirst.mockResolvedValue(sampleInvoice({ status: 'VOIDED' }));
      await expect(service.matchToExpense('building-1', 'inv-1', undefined, user)).rejects.toThrow(BadRequestException);

      prisma.supplierInvoice.findFirst.mockResolvedValue(null);
      await expect(service.matchToExpense('building-1', 'missing', undefined, user)).rejects.toThrow(NotFoundException);
    });

    it('throws when building has no units', async () => {
      prisma.supplierInvoice.findFirst.mockResolvedValue(sampleInvoice({ status: 'DRAFT', expenseId: null }));
      prisma.unit.findMany.mockResolvedValue([]);
      await expect(service.matchToExpense('building-1', 'inv-1', undefined, user)).rejects.toThrow(BadRequestException);
    });
  });

  describe('voidInvoice', () => {
    it('sets status VOIDED and audits', async () => {
      prisma.supplierInvoice.findFirst.mockResolvedValue(sampleInvoice({ id: 'inv-1', status: 'DRAFT' }));
      prisma.supplierInvoice.update.mockResolvedValue(sampleInvoice({ id: 'inv-1', status: 'VOIDED' }));
      const res = await service.voidInvoice('building-1', 'inv-1', user);
      expect(res.status).toBe('VOIDED');
      expect(prisma.supplierInvoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { status: 'VOIDED' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'supplier_invoice.voided' }));
    });

    it('rejects already voided or missing', async () => {
      prisma.supplierInvoice.findFirst.mockResolvedValue(sampleInvoice({ status: 'VOIDED' }));
      await expect(service.voidInvoice('building-1', 'inv-1', user)).rejects.toThrow(BadRequestException);
      prisma.supplierInvoice.findFirst.mockResolvedValue(null);
      await expect(service.voidInvoice('building-1', 'missing', user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats', () => {
    it('computes totals by status, monthly intake, VAT summary', async () => {
      prisma.supplierInvoice.findMany.mockResolvedValue([
        sampleInvoice({ status: 'DRAFT', netCents: 10000, vatCents: 2400, totalCents: 12400, issueDate: new Date('2026-08-10') }),
        sampleInvoice({ id: '2', status: 'IMPORTED', netCents: 5000, vatCents: 1200, totalCents: 6200, issueDate: new Date('2026-08-11') }),
        sampleInvoice({ id: '3', status: 'MATCHED', netCents: 20000, vatCents: 4800, totalCents: 24800, issueDate: new Date('2026-07-05'), classification: 'category1_2' }),
        sampleInvoice({ id: '4', status: 'VOIDED', netCents: 1000, vatCents: 240, totalCents: 1240, issueDate: new Date('2026-08-12') }),
      ]);
      const stats = await service.getStats('building-1', user);
      expect(stats.totalCount).toBe(4);
      expect(stats.countByStatus.DRAFT).toBe(1);
      expect(stats.countByStatus.IMPORTED).toBe(1);
      expect(stats.countByStatus.MATCHED).toBe(1);
      expect(stats.countByStatus.VOIDED).toBe(1);
      expect(stats.draftCount).toBe(1);
      // voided excluded from totals
      expect(stats.totals.totalCents).toBe(12400 + 6200 + 24800);
      expect(stats.totals.netCents).toBe(10000 + 5000 + 20000);
      expect(stats.monthly).toHaveLength(2);
      expect(stats.monthly.find((m) => m.month === '2026-08')!.totalCents).toBe(12400 + 6200);
      expect(stats.vatSummary.byClassification['category1_1'].count).toBe(2); // two with default classification
      expect(stats.vatSummary.byClassification['category1_2'].netCents).toBe(20000);
    });

    it('respects tenant isolation', async () => {
      await expect(service.getStats('building-9', user)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getById', () => {
    it('returns invoice scoped to building', async () => {
      prisma.supplierInvoice.findFirst.mockResolvedValue(sampleInvoice({ id: 'inv-1', buildingId: 'building-1' }));
      const res = await service.getById('building-1', 'inv-1', user);
      expect(res.id).toBe('inv-1');
    });

    it('throws 404 for foreign building', async () => {
      prisma.supplierInvoice.findFirst.mockResolvedValue(null);
      await expect(service.getById('building-1', 'missing', user)).rejects.toThrow(NotFoundException);
      await expect(service.getById('building-9', 'inv-1', user)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('helpers - OCR & myDATA parsing', () => {
    it('ocr extracts AFM, dates, amounts and confidence', () => {
      const text = OcrService.buildFakeInvoiceText({
        issuerName: 'Test Supplier',
        issuerAfm: '987654321',
        issueDate: '2026-08-20',
        netCents: 10000,
        vatCents: 2400,
        totalCents: 12400,
      });
      const ocrRes = new OcrService().extractFromText(text);
      expect(ocrRes.issuerName).toBe('Test Supplier');
      expect(ocrRes.issuerAfm).toBe('987654321');
      expect(ocrRes.issueDate).toBe('2026-08-20');
      expect(ocrRes.totalCents).toBe(12400);
      expect(ocrRes.netCents).toBe(10000);
      expect(ocrRes.confidence).toBeGreaterThan(80);
    });
  });
});
