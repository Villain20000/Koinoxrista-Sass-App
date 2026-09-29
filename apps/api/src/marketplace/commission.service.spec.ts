import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { buildCommissionSummary, CommissionsService } from './commission.service';

const admin = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'comm-1',
  buildingId: 'building-1',
  jobId: 'job-1',
  providerId: 'provider-1',
  baseCents: 10_000,
  rateBps: 400,
  amountCents: 400,
  status: 'DUE',
  paidAt: null,
  createdAt: new Date('2026-03-15T10:00:00Z'),
  ...overrides,
});

function makePrisma() {
  return {
    jobCommission: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

describe('buildCommissionSummary', () => {
  it('zero-fills twelve months and aggregates per award month', () => {
    const summary = buildCommissionSummary(2026, [
      {
        baseCents: 100,
        amountCents: 4,
        createdAt: new Date('2026-01-05T00:00:00Z'),
      },
      {
        baseCents: 200,
        amountCents: 8,
        createdAt: new Date('2026-01-20T00:00:00Z'),
      },
      {
        baseCents: 50,
        amountCents: 2,
        createdAt: new Date('2026-12-31T23:59:59Z'),
      },
    ]);

    expect(summary.year).toBe(2026);
    expect(summary.months).toHaveLength(12);
    expect(summary.months[0]).toEqual({
      month: '2026-01',
      awardedCents: 300,
      commissionCents: 12,
    });
    expect(summary.months[11]).toEqual({
      month: '2026-12',
      awardedCents: 50,
      commissionCents: 2,
    });
    expect(summary.months[5].awardedCents).toBe(0);
    expect(summary.totals).toEqual({ awardedCents: 350, commissionCents: 14 });
  });

  it('is zero-safe for an empty year', () => {
    const summary = buildCommissionSummary(2030, []);
    expect(summary.months.every((m) => m.awardedCents === 0)).toBe(true);
    expect(summary.totals).toEqual({ awardedCents: 0, commissionCents: 0 });
  });
});

describe('CommissionsService', () => {
  let service: CommissionsService;
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new CommissionsService(
      prisma as unknown as PrismaService,
      audit,
    );
  });

  describe('createForAward', () => {
    it('computes the commission with env settings and audits the creation', async () => {
      prisma.jobCommission.create.mockImplementation(({ data }) =>
        Promise.resolve(row(data)),
      );

      const dto = await service.createForAward({
        buildingId: 'building-1',
        jobId: 'job-1',
        providerId: 'provider-1',
        baseCents: 12_345,
      });

      // 12345 × 4% = 493.8 → 494 (half-up), under the €500 cap
      expect(dto?.amountCents).toBe(494);
      expect(prisma.jobCommission.create).toHaveBeenCalledWith({
        data: {
          buildingId: 'building-1',
          jobId: 'job-1',
          providerId: 'provider-1',
          baseCents: 12_345,
          rateBps: 400,
          amountCents: 494,
        },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'commission.create',
          entity: 'job_commission',
          metadata: expect.objectContaining({ jobId: 'job-1', amountCents: 494 }),
        }),
      );
    });

    it('caps the computed commission at the configured ceiling', async () => {
      prisma.jobCommission.create.mockResolvedValue(row());

      await service.createForAward({
        buildingId: 'building-1',
        jobId: 'job-1',
        providerId: 'provider-1',
        baseCents: 50_000_000, // 4% would be €2 000
      });

      expect(prisma.jobCommission.create.mock.calls[0][0].data.amountCents).toBe(
        50_000,
      );
    });

    it('is idempotent per job and skips the insert when a row exists', async () => {
      prisma.jobCommission.findUnique.mockResolvedValue(row());

      const dto = await service.createForAward({
        buildingId: 'building-1',
        jobId: 'job-1',
        providerId: 'provider-1',
        baseCents: 10_000,
      });

      expect(prisma.jobCommission.create).not.toHaveBeenCalled();
      expect(dto?.id).toBe('comm-1');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('maps a concurrent P2002 race to null without throwing', async () => {
      prisma.jobCommission.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.createForAward({
          buildingId: 'building-1',
          jobId: 'job-1',
          providerId: 'provider-1',
          baseCents: 10_000,
        }),
      ).resolves.toBeNull();
    });
  });

  describe('list', () => {
    it('lists newest-first with job/provider names and optional status filter', async () => {
      prisma.jobCommission.findMany.mockResolvedValue([
        row({ status: 'PAID', paidAt: new Date('2026-04-01T00:00:00Z') }),
      ]);

      const items = await service.list('building-1', admin(), 'PAID');

      expect(prisma.jobCommission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buildingId: 'building-1', status: 'PAID' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(items[0]).toMatchObject({
        status: 'PAID',
        paidAt: '2026-04-01T00:00:00.000Z',
      });
      // No included relations → denormalized fields stay null.
      expect(items[0].jobTitle).toBeNull();
      expect(items[0].providerName).toBeNull();
    });

    it('denormalizes job title and provider name when included', async () => {
      prisma.jobCommission.findMany.mockResolvedValue([
        row({
          job: { title: 'Συντήρηση ανελκυστήρα' },
          provider: { firstName: 'Νίκος', lastName: 'Παπάς' },
        }),
      ]);

      const [item] = await service.list('building-1', admin());

      expect(item.jobTitle).toBe('Συντήρηση ανελκυστήρα');
      expect(item.providerName).toBe('Νίκος Παπάς');
    });

    it('forbids another building', async () => {
      await expect(service.list('building-2', admin())).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('markPaid', () => {
    it('transitions DUE → PAID with paidAt and writes an audit entry', async () => {
      prisma.jobCommission.findUnique.mockResolvedValue(row());
      prisma.jobCommission.update.mockResolvedValue(
        row({ status: 'PAID', paidAt: new Date('2026-08-01T00:00:00Z') }),
      );

      const dto = await service.markPaid('comm-1', admin());

      expect(dto.status).toBe('PAID');
      expect(dto.paidAt).toBe('2026-08-01T00:00:00.000Z');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'commission.mark-paid',
          entity: 'job_commission',
          entityId: 'comm-1',
        }),
      );
    });

    it('is idempotent for already-paid commissions', async () => {
      prisma.jobCommission.findUnique.mockResolvedValue(
        row({ status: 'PAID', paidAt: new Date('2026-08-01T00:00:00Z') }),
      );

      const dto = await service.markPaid('comm-1', admin());

      expect(prisma.jobCommission.update).not.toHaveBeenCalled();
      expect(dto.status).toBe('PAID');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuses to mark waived commissions as paid', async () => {
      prisma.jobCommission.findUnique.mockResolvedValue(
        row({ status: 'WAIVED' }),
      );

      await expect(service.markPaid('comm-1', admin())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound for foreign or missing rows', async () => {
      prisma.jobCommission.findUnique.mockResolvedValue(null);

      await expect(service.markPaid('missing', admin())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('waive', () => {
    it('transitions DUE → WAIVED without touching paidAt and audits it', async () => {
      prisma.jobCommission.findUnique.mockResolvedValue(row());
      prisma.jobCommission.update.mockResolvedValue(row({ status: 'WAIVED' }));

      const dto = await service.waive('comm-1', admin());

      expect(prisma.jobCommission.update).toHaveBeenCalledWith({
        where: { id: 'comm-1' },
        data: { status: 'WAIVED' },
        include: expect.anything(),
      });
      expect(dto.status).toBe('WAIVED');
      expect(dto.paidAt).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'commission.waive' }),
      );
    });

    it('refuses to waive an already-paid commission', async () => {
      prisma.jobCommission.findUnique.mockResolvedValue(
        row({ status: 'PAID', paidAt: new Date() }),
      );

      await expect(service.waive('comm-1', admin())).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.jobCommission.update).not.toHaveBeenCalled();
    });
  });

  describe('summary', () => {
    it('queries the year window in UTC and groups monthly volume', async () => {
      prisma.jobCommission.findMany.mockResolvedValue([
        {
          baseCents: 1_000,
          amountCents: 40,
          createdAt: new Date('2026-02-10T00:00:00Z'),
        },
      ]);

      const summary = await service.summary('building-1', 2026, admin());

      const where = prisma.jobCommission.findMany.mock.calls[0][0].where;
      expect(where.buildingId).toBe('building-1');
      expect(where.createdAt.gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
      expect(where.createdAt.lt).toEqual(new Date(Date.UTC(2027, 0, 1)));

      expect(summary.months[1]).toEqual({
        month: '2026-02',
        awardedCents: 1_000,
        commissionCents: 40,
      });
      expect(summary.totals).toEqual({ awardedCents: 1_000, commissionCents: 40 });
    });

    it('forbids another building', async () => {
      await expect(
        service.summary('building-2', 2026, admin()),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
