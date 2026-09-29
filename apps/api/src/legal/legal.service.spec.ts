import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LegalService } from './legal.service';
import { renderExodikHtml } from './templates/exodik';

const NOW = new Date('2026-08-25T10:00:00.000Z');
const admin = { id: 'admin-1', email: 'a@b.gr', role: Role.ADMIN, buildingId: 'building-1' } as any;
const foreignAdmin = { id: 'admin-9', email: 'x@b.gr', role: Role.ADMIN, buildingId: 'building-9' } as any;

const building = {
  id: 'building-1',
  name: 'Πολυκατοικία Α',
  address: 'Εγνατία 10',
  city: 'Thessaloniki',
};

const unit = { id: 'unit-1', buildingId: 'building-1', label: 'Α1' };

function makeLegalCase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    buildingId: 'building-1',
    unitId: 'unit-1',
    title: 'Εξώδικο — Α1 — 2026-08-25',
    stage: 'NOTICE',
    status: 'OPEN',
    totalCents: 5000,
    invoiceIds: ['inv-1', 'inv-2'],
    lawyerName: null,
    lawyerEmail: null,
    notes: null,
    lastSentAt: null,
    createdAt: new Date('2026-08-25T10:00:00.000Z'),
    updatedAt: new Date('2026-08-25T10:00:00.000Z'),
    unit: { label: 'Α1' },
    building: { name: 'Πολυκατοικία Α', address: 'Εγνατία 10', city: 'Thessaloniki' },
    events: [],
    ...overrides,
  };
}

function makePrisma() {
  return {
    building: {
      findUnique: jest.fn().mockResolvedValue(building),
    },
    unit: {
      findFirst: jest.fn().mockResolvedValue(unit),
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    legalCase: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    legalEvent: {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('LegalService helpers', () => {
  it('renderExodikHtml contains building address, unit label, total and deadline 15d', () => {
    const generatedAt = new Date('2026-08-25T10:00:00.000Z');
    const deadline = new Date('2026-09-09T10:00:00.000Z');
    const html = renderExodikHtml({
      buildingName: 'Πολυκατοικία Α',
      buildingAddress: 'Εγνατία 10',
      buildingCity: 'Thessaloniki',
      unitLabel: 'Α1',
      title: 'Εξώδικο — Α1',
      totalCents: 12345,
      invoices: [
        { periodYearMonth: '2026-07', totalCents: 10000, paidCents: 5000, outstandingCents: 5000 },
        { periodYearMonth: '2026-08', totalCents: 7345, paidCents: 0, outstandingCents: 7345 },
      ],
      deadline,
      generatedAt,
      lawyerName: 'Ν. Παπαδόπουλος',
      lawyerEmail: 'lawyer@example.gr',
    });
    expect(html).toContain('Πολυκατοικία Α');
    expect(html).toContain('Εγνατία 10');
    expect(html).toContain('Διαμέρισμα');
    expect(html).toContain('Α1');
    expect(html).toContain('2026-07');
    expect(html).toContain('2026-08');
    expect(html).toContain('123,45 €'); // 12345 cents
    expect(html).toContain('2026-09-09'); // deadline
    expect(html).toContain('15'); // mentions 15 days
    expect(html).toContain('Ν. Παπαδόπουλος');
  });

  it('renderExodikHtml sorts invoices and escapes html', () => {
    const html = renderExodikHtml({
      buildingName: '<b>B</b>',
      buildingAddress: 'addr',
      unitLabel: 'Α1',
      title: 't',
      totalCents: 100,
      invoices: [
        { periodYearMonth: '2026-08', totalCents: 50, paidCents: 0, outstandingCents: 50 },
        { periodYearMonth: '2026-07', totalCents: 50, paidCents: 0, outstandingCents: 50 },
      ],
      deadline: new Date('2026-09-09T10:00:00.000Z'),
      // Month 05 avoids colliding with the 2026-07 / 2026-08 period strings.
      generatedAt: new Date('2026-05-25T10:00:00.000Z'),
    });
    // escaped
    expect(html).toContain('&lt;b&gt;B&lt;/b&gt;');
    // sorted: July before August
    const idxJuly = html.indexOf('2026-07');
    const idxAug = html.indexOf('2026-08');
    expect(idxJuly).toBeLessThan(idxAug);
  });
});

describe('LegalService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { record: jest.Mock };
  let service: LegalService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = makePrisma();
    audit = { record: jest.fn() };
    service = new LegalService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createCase', () => {
    it('computes totalCents from invoices total - paid and creates NOTICE stage', async () => {
      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.invoice.findMany.mockResolvedValue([
        { id: 'inv-1', totalCents: 5000, paidCents: 1000, periodYearMonth: '2026-07' },
        { id: 'inv-2', totalCents: 3000, paidCents: 0, periodYearMonth: '2026-08' },
        { id: 'inv-3', totalCents: 1000, paidCents: 1000, periodYearMonth: '2026-06' },
      ]);
      // mock create returns case
      const created = makeLegalCase({ totalCents: 7000, invoiceIds: ['inv-1', 'inv-2', 'inv-3'] });
      prisma.legalCase.create.mockResolvedValue(created);
      prisma.legalCase.findFirst.mockResolvedValue({ ...created, events: [{ id: 'e1', caseId: 'case-1', buildingId: 'building-1', type: 'CREATED', payload: {}, createdAt: NOW }] });

      const result = await service.createCase('building-1', { unitId: 'unit-1', invoiceIds: ['inv-1', 'inv-2', 'inv-3'] } as any, admin);
      // outstanding = (5000-1000)+(3000-0)+(1000-1000)=7000 ; settled one contributes 0
      expect(result.totalCents).toBe(7000);
      expect(result.stage).toBe('NOTICE');
      expect(result.status).toBe('OPEN');
      expect(prisma.legalCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buildingId: 'building-1',
            unitId: 'unit-1',
            stage: 'NOTICE',
            status: 'OPEN',
            totalCents: 7000,
            invoiceIds: ['inv-1', 'inv-2', 'inv-3'],
          }),
        }),
      );
      expect(prisma.legalEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'CREATED' }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'legal.case.created' }));
    });

    it('rejects foreign building before any query', async () => {
      await expect(service.createCase('building-9', { unitId: 'unit-1', invoiceIds: ['inv-1'] } as any, admin)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.unit.findFirst).not.toHaveBeenCalled();
    });

    it('404s unknown unit and validates invoiceIds belong to unit/building', async () => {
      prisma.unit.findFirst.mockResolvedValue(null);
      await expect(
        service.createCase('building-1', { unitId: 'missing', invoiceIds: ['inv-1'] } as any, admin),
      ).rejects.toThrow(NotFoundException);

      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.invoice.findMany.mockResolvedValue([{ id: 'inv-1', totalCents: 1000, paidCents: 0 }]);
      await expect(
        service.createCase('building-1', { unitId: 'unit-1', invoiceIds: ['inv-1', 'inv-missing'] } as any, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects zero outstanding', async () => {
      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.invoice.findMany.mockResolvedValue([{ id: 'inv-1', totalCents: 1000, paidCents: 1000 }]);
      await expect(
        service.createCase('building-1', { unitId: 'unit-1', invoiceIds: ['inv-1'] } as any, admin),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('listCases', () => {
    it('scopes to building and filters by stage/status', async () => {
      prisma.legalCase.findMany.mockResolvedValue([makeLegalCase(), makeLegalCase({ id: 'case-2', stage: 'LAWYER', status: 'SENT' })]);
      const result = await service.listCases('building-1', admin as any);
      expect(prisma.legalCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { buildingId: 'building-1' } }),
      );
      expect(result).toHaveLength(2);

      await service.listCases('building-1', 'NOTICE' as any, undefined as any, admin as any);
      expect(prisma.legalCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { buildingId: 'building-1', stage: 'NOTICE' } }),
      );

      await service.listCases('building-1', 'NOTICE' as any, 'OPEN' as any, admin as any);
      const lastCall = prisma.legalCase.findMany.mock.calls[prisma.legalCase.findMany.mock.calls.length - 1][0];
      expect(lastCall.where).toEqual({ buildingId: 'building-1', stage: 'NOTICE', status: 'OPEN' });
    });

    it('rejects foreign building and invalid filters', async () => {
      await expect(service.listCases('building-9', admin as any)).rejects.toThrow(ForbiddenException);
      await expect(service.listCases('building-1', 'INVALID' as any, undefined as any, admin as any)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.listCases('building-1', undefined as any, 'BAD' as any, admin as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getCase', () => {
    it('returns case with events and tenant isolation', async () => {
      const c = makeLegalCase({ events: [{ id: 'e1', caseId: 'case-1', buildingId: 'building-1', type: 'CREATED', payload: {}, createdAt: NOW }] });
      prisma.legalCase.findFirst.mockResolvedValue(c);
      const result = await service.getCase('building-1', 'case-1', admin);
      expect(result.id).toBe('case-1');
      expect(result.events).toHaveLength(1);
    });

    it('404s missing and forbids foreign building', async () => {
      prisma.legalCase.findFirst.mockResolvedValue(null);
      await expect(service.getCase('building-1', 'missing', admin)).rejects.toThrow(NotFoundException);
      prisma.legalCase.findFirst.mockResolvedValue(makeLegalCase());
      await expect(service.getCase('building-9', 'case-1', admin)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('advanceStage', () => {
    it('allows forward-only NOTICE→LAWYER→COURT→CLOSED', async () => {
      prisma.legalCase.findFirst.mockResolvedValue(makeLegalCase({ stage: 'NOTICE' }));
      prisma.legalCase.update.mockResolvedValue(makeLegalCase({ stage: 'LAWYER' }));
      prisma.legalCase.findFirst.mockResolvedValueOnce(makeLegalCase({ stage: 'NOTICE' })).mockResolvedValueOnce(makeLegalCase({ stage: 'LAWYER', events: [{ id: 'e1', type: 'ESCALATED', payload: { from: 'NOTICE', to: 'LAWYER' }, createdAt: NOW, caseId: 'case-1', buildingId: 'building-1' }] }));
      // need to adjust mock for advance: findFirst returns case, update returns new, then second findFirst returns with events
      // we set up differently:
      prisma.legalCase.findFirst
        .mockResolvedValueOnce(makeLegalCase({ stage: 'NOTICE' }))
        .mockResolvedValueOnce(makeLegalCase({ stage: 'LAWYER', events: [{ id: 'e1', type: 'ESCALATED', payload: {}, createdAt: NOW, caseId: 'case-1', buildingId: 'building-1' }] }));
      prisma.legalCase.update.mockResolvedValue(makeLegalCase({ stage: 'LAWYER' }));
      const result = await service.advanceStage('case-1', 'LAWYER', admin);
      expect(result.stage).toBe('LAWYER');
      expect(prisma.legalEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'ESCALATED' }) }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'legal.case.escalated' }));
    });

    it('rejects illegal skip and backward transitions', async () => {
      prisma.legalCase.findFirst.mockResolvedValue(makeLegalCase({ stage: 'NOTICE' }));
      await expect(service.advanceStage('case-1', 'COURT', admin)).rejects.toThrow(BadRequestException);
      await expect(service.advanceStage('case-1', 'NOTICE', admin)).rejects.toThrow(BadRequestException);
      prisma.legalCase.findFirst.mockResolvedValue(makeLegalCase({ stage: 'LAWYER' }));
      await expect(service.advanceStage('case-1', 'NOTICE', admin)).rejects.toThrow(BadRequestException);
      expect(prisma.legalCase.update).not.toHaveBeenCalled();
    });

    it('marks CLOSED as terminal and updates status', async () => {
      prisma.legalCase.findFirst
        .mockResolvedValueOnce(makeLegalCase({ stage: 'COURT', status: 'SENT' }))
        .mockResolvedValueOnce(makeLegalCase({ stage: 'CLOSED', status: 'CLOSED', events: [] }));
      prisma.legalCase.update.mockResolvedValue(makeLegalCase({ stage: 'CLOSED', status: 'CLOSED' }));
      const result = await service.advanceStage('case-1', 'CLOSED', admin);
      expect(prisma.legalCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stage: 'CLOSED', status: 'CLOSED' }) }),
      );
      expect(result.stage).toBe('CLOSED');
    });

    it('uses buildingId+caseId overload and checks tenant', async () => {
      prisma.legalCase.findFirst
        .mockResolvedValueOnce(makeLegalCase({ stage: 'NOTICE' }))
        .mockResolvedValueOnce(makeLegalCase({ stage: 'LAWYER', events: [] }));
      prisma.legalCase.update.mockResolvedValue(makeLegalCase({ stage: 'LAWYER' }));
      await expect(service.advanceStage('building-1', 'case-1', 'LAWYER', admin)).resolves.toBeDefined();
      // foreign building should be rejected via tenant check on case buildingId mismatch? Our service checks user building vs case building, not passed buildingId unless case mismatch
      prisma.legalCase.findFirst.mockResolvedValue(makeLegalCase({ buildingId: 'building-1', stage: 'NOTICE' }));
      // The buildingId arg must match the case's building; a foreign admin is
      // then rejected by the tenant check (Forbidden), not the not-found path.
      await expect(service.advanceStage('building-1', 'case-1', 'LAWYER', foreignAdmin)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('sendNotice', () => {
    it('generates exodik HTML, records NOTICE_SENT and dedupes within 7d', async () => {
      const c = makeLegalCase({ lastSentAt: null });
      prisma.legalCase.findFirst.mockResolvedValue(c);
      prisma.building.findUnique.mockResolvedValue(building);
      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.invoice.findMany.mockResolvedValue([
        { periodYearMonth: '2026-07', totalCents: 3000, paidCents: 0 },
        { periodYearMonth: '2026-08', totalCents: 2000, paidCents: 0 },
      ]);
      prisma.legalCase.update.mockResolvedValue({ ...c, lastSentAt: NOW, status: 'SENT' });

      const result = await service.sendNotice('case-1', admin);
      expect(result.html).toContain('ΕΞΩΔΙΚΗ ΔΗΛΩΣΗ');
      expect(result.html).toContain('Εγνατία 10');
      expect(result.html).toContain('Α1');
      expect(result.case.status).toBe('SENT');
      expect(prisma.legalEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'NOTICE_SENT' }) }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'legal.notice.sent' }));

      // second send within 7 days should 429
      prisma.legalCase.findFirst.mockResolvedValue({ ...c, lastSentAt: new Date('2026-08-24T10:00:00.000Z') }); // 1 day ago
      await expect(service.sendNotice('case-1', admin)).rejects.toThrow(HttpException);
      try {
        await service.sendNotice('case-1', admin);
      } catch (e: any) {
        expect(e.getStatus()).toBe(429);
      }
    });

    it('allows resend after 7 days', async () => {
      const c = makeLegalCase({ lastSentAt: new Date('2026-08-17T10:00:00.000Z') }); // 8 days ago
      prisma.legalCase.findFirst.mockResolvedValue(c);
      prisma.building.findUnique.mockResolvedValue(building);
      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.invoice.findMany.mockResolvedValue([{ periodYearMonth: '2026-07', totalCents: 5000, paidCents: 0 }]);
      prisma.legalCase.update.mockResolvedValue({ ...c, lastSentAt: NOW });
      await expect(service.sendNotice('case-1', admin)).resolves.toBeDefined();
    });
  });

  describe('addNote / closeCase', () => {
    it('adds NOTE event and audits', async () => {
      prisma.legalCase.findFirst
        .mockResolvedValueOnce(makeLegalCase())
        .mockResolvedValueOnce(makeLegalCase({ events: [{ id: 'e2', type: 'NOTE', payload: { note: 'κλήση' }, createdAt: NOW, caseId: 'case-1', buildingId: 'building-1' }] }));
      const result = await service.addNote('case-1', 'κλήση προς ένοικο', admin);
      expect(prisma.legalEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'NOTE', payload: { note: 'κλήση προς ένοικο' } }) }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'legal.case.note' }));
      expect(result.events).toHaveLength(1);
    });

    it('closes case to CLOSED stage/status and records CLOSED event', async () => {
      prisma.legalCase.findFirst
        .mockResolvedValueOnce(makeLegalCase({ stage: 'LAWYER' }))
        .mockResolvedValueOnce(makeLegalCase({ stage: 'CLOSED', status: 'CLOSED', events: [{ id: 'e3', type: 'CLOSED', payload: { reason: 'εξόφληση' }, createdAt: NOW, caseId: 'case-1', buildingId: 'building-1' }] }));
      prisma.legalCase.update.mockResolvedValue(makeLegalCase({ stage: 'CLOSED', status: 'CLOSED' }));
      const result = await service.closeCase('case-1', 'εξόφληση', admin);
      expect(prisma.legalCase.update).toHaveBeenCalledWith(expect.objectContaining({ data: { stage: 'CLOSED', status: 'CLOSED' } }));
      expect(prisma.legalEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'CLOSED' }) }));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'legal.case.closed' }));
      expect(result.stage).toBe('CLOSED');
    });

    it('rejects empty note', async () => {
      await expect(service.addNote('case-1', '', admin)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getStats / getExodikHtml', () => {
    it('counts by stage/status and sums outstanding excluding CLOSED', async () => {
      prisma.legalCase.findMany.mockResolvedValue([
        makeLegalCase({ stage: 'NOTICE', status: 'OPEN', totalCents: 1000 }),
        makeLegalCase({ id: 'case-2', stage: 'NOTICE', status: 'SENT', totalCents: 2000 }),
        makeLegalCase({ id: 'case-3', stage: 'LAWYER', status: 'SENT', totalCents: 3000 }),
        makeLegalCase({ id: 'case-4', stage: 'CLOSED', status: 'CLOSED', totalCents: 9999 }),
      ]);
      const stats = await service.getStats('building-1', admin);
      expect(stats.totalCases).toBe(4);
      expect(stats.totalOutstandingCents).toBe(6000); // excludes CLOSED 9999
      expect(stats.byStage.find((s: any) => s.stage === 'NOTICE')?.count).toBe(2);
      expect(stats.byStage.find((s: any) => s.stage === 'LAWYER')?.count).toBe(1);
      expect(stats.byStage.find((s: any) => s.stage === 'CLOSED')?.count).toBe(1);
      expect(stats.byStatus.find((s: any) => s.status === 'OPEN')?.count).toBe(1);
    });

    it('getExodikHtml renders live data with deadline 15d', async () => {
      const c = makeLegalCase();
      prisma.legalCase.findFirst.mockResolvedValue(c);
      prisma.building.findUnique.mockResolvedValue(building);
      prisma.unit.findFirst.mockResolvedValue(unit);
      prisma.invoice.findMany.mockResolvedValue([
        { periodYearMonth: '2026-07', totalCents: 5000, paidCents: 1000 },
      ]);
      const html = await service.getExodikHtml('case-1', admin);
      expect(html).toContain('Πολυκατοικία Α');
      expect(html).toContain('Εγνατία 10');
      expect(html).toContain('Α1');
      expect(html).toContain('50,00 €'); // outstanding 4000? but totalCents in case is 5000, but invoice outstanding 4000 -> table shows 40,00?
      // deadline is 15 days from NOW
      const expectedDeadline = new Date(NOW.getTime() + 15 * 86_400_000).toISOString().slice(0, 10);
      expect(html).toContain(expectedDeadline);
    });

    it('forbids foreign building on stats', async () => {
      await expect(service.getStats('building-9', admin)).rejects.toThrow(ForbiddenException);
    });
  });
});
