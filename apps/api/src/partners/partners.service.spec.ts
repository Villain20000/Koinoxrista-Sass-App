import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  PIPELINE_ORDER,
  canTransition,
  nextStatuses,
  validateStatusChange,
} from './pipeline';
import { PartnersService } from './partners.service';

const auditStub = () => ({ record: jest.fn() }) as unknown as AuditService;

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

function makePrisma() {
  return {
    partnerLead: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

const createdAt = new Date('2026-02-10T10:00:00.000Z');
const updatedAt = new Date('2026-03-01T09:00:00.000Z');

function makeLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-1',
    buildingId: 'building-1',
    partnerName: 'Ασφαλιστικός Σύμβουλος ΑΕ',
    category: 'INSURANCE',
    contactName: 'Γιώργος Παπαδόπουλος',
    contactEmail: 'broker@example.gr',
    contactPhone: '+30 210 1234567',
    expectedCommissionCents: 20_000,
    actualCommissionCents: null,
    status: 'NEW',
    notes: null,
    createdById: 'admin-1',
    createdAt,
    updatedAt,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure pipeline
// ---------------------------------------------------------------------------

describe('partner lead pipeline (pure)', () => {
  it('orders stages NEW → CONTACTED → QUOTED → WON/LOST', () => {
    expect(PIPELINE_ORDER).toEqual(['NEW', 'CONTACTED', 'QUOTED', 'WON', 'LOST']);
  });

  it('allows exactly the forward-only transition matrix', () => {
    const allowed: [string, string][] = [
      ['NEW', 'CONTACTED'],
      ['CONTACTED', 'QUOTED'],
      ['QUOTED', 'WON'],
      ['QUOTED', 'LOST'],
    ];
    for (const [from, to] of allowed) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('rejects backward moves, self-moves and skips', () => {
    const rejected: [string, string][] = [
      ['NEW', 'NEW'],
      ['NEW', 'QUOTED'],
      ['NEW', 'WON'],
      ['NEW', 'LOST'],
      ['CONTACTED', 'NEW'],
      ['CONTACTED', 'WON'],
      ['QUOTED', 'CONTACTED'],
      ['WON', 'QUOTED'],
      ['LOST', 'NEW'],
      ['BOGUS', 'NEW'],
      ['NEW', 'BOGUS'],
    ];
    for (const [from, to] of rejected) {
      expect(canTransition(from, to)).toBe(false);
    }
  });

  it('exposes no exits for the terminal stages', () => {
    expect(nextStatuses('WON')).toEqual([]);
    expect(nextStatuses('LOST')).toEqual([]);
  });

  it('requires an actual commission ≥ 0 to move to WON', () => {
    expect(validateStatusChange('QUOTED', 'WON')).toMatchObject({
      ok: false,
      reason: 'WON_REQUIRES_AMOUNT',
    });
    expect(validateStatusChange('QUOTED', 'WON', -1)).toMatchObject({
      ok: false,
      reason: 'WON_REQUIRES_AMOUNT',
    });
    expect(validateStatusChange('QUOTED', 'WON', 12.5)).toMatchObject({
      ok: false,
      reason: 'WON_REQUIRES_AMOUNT',
    });
    expect(validateStatusChange('QUOTED', 'WON', 0)).toEqual({ ok: true });
    expect(validateStatusChange('QUOTED', 'WON', 15_000)).toEqual({ ok: true });
  });

  it('reports typed results for illegal moves', () => {
    expect(validateStatusChange('CONTACTED', 'WON')).toMatchObject({
      ok: false,
      reason: 'ILLEGAL_TRANSITION',
    });
    expect(validateStatusChange('NOPE', 'NEW')).toMatchObject({
      ok: false,
      reason: 'UNKNOWN_STATUS',
    });
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

describe('PartnersService.list', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: PartnersService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PartnersService(prisma as unknown as PrismaService, auditStub());
  });

  it('lists newest-first and narrows by status/category filters', async () => {
    prisma.partnerLead.findMany.mockResolvedValue([makeLead()]);

    await expect(
      service.list('building-1', admin, { status: 'NEW', category: 'INSURANCE' }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'lead-1',
        status: 'NEW',
        actualCommissionCents: null,
        createdAt: createdAt.toISOString(),
      }),
    ]);
    const call = prisma.partnerLead.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      buildingId: 'building-1',
      status: 'NEW',
      category: 'INSURANCE',
    });
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('forbids access to another building', async () => {
    await expect(service.list('building-2', admin)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects invalid filter values', async () => {
    await expect(
      service.list('building-1', admin, { status: 'ARCHIVED' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.list('building-1', admin, { category: 'PLUMBING' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('PartnersService.create', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;
  let service: PartnersService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new PartnersService(prisma as unknown as PrismaService, audit);
  });

  it('creates the lead with createdById and writes partner_lead.created', async () => {
    prisma.partnerLead.create.mockImplementation(({ data }) =>
      Promise.resolve(makeLead({ id: 'lead-new', ...data })),
    );

    await expect(
      service.create(
        'building-1',
        {
          partnerName: 'Συντηρητής ανελκυστήρων ΟΕ',
          category: 'ELEVATOR',
          contactName: 'Μαρία Ιωάννου',
          expectedCommissionCents: 5_000,
        },
        admin,
      ),
    ).resolves.toMatchObject({ id: 'lead-new', status: 'NEW' });

    expect(prisma.partnerLead.create.mock.calls[0][0].data).toMatchObject({
      buildingId: 'building-1',
      partnerName: 'Συντηρητής ανελκυστήρων ΟΕ',
      category: 'ELEVATOR',
      expectedCommissionCents: 5_000,
      createdById: 'admin-1',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'partner_lead.created',
        entity: 'partner_lead',
        entityId: 'lead-new',
        actorId: 'admin-1',
      }),
    );
  });

  it('forbids creating for another building', async () => {
    await expect(
      service.create(
        'building-2',
        { partnerName: 'Χ', category: 'OTHER', expectedCommissionCents: 100 },
        admin,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.partnerLead.create).not.toHaveBeenCalled();
  });
});

describe('PartnersService.update', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;
  let service: PartnersService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new PartnersService(prisma as unknown as PrismaService, audit);
  });

  it('patches only provided fields of an owned lead and audits', async () => {
    prisma.partnerLead.findFirst.mockResolvedValue(makeLead());
    prisma.partnerLead.update.mockImplementation(({ data }) =>
      Promise.resolve(makeLead(data)),
    );

    await service.update('lead-1', { notes: 'Πρόσφορα στάλθηκαν' }, admin);

    expect(prisma.partnerLead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: { notes: 'Πρόσφορα στάλθηκαν' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'partner_lead.updated' }),
    );
  });

  it('404s when the lead belongs to another building (tenancy isolation)', async () => {
    prisma.partnerLead.findFirst.mockResolvedValue(null);
    await expect(
      service.update('lead-foreign', { notes: 'x' }, admin),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.partnerLead.update).not.toHaveBeenCalled();

    // Reads/writes are always scoped by the caller's own buildingId.
    const otherBuildingAdmin = { ...admin, buildingId: 'building-9' };
    await service.list('building-9', otherBuildingAdmin);
    expect(prisma.partnerLead.findMany.mock.calls[0][0].where).toEqual({
      buildingId: 'building-9',
    });
  });
});

describe('PartnersService.changeStatus', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;
  let service: PartnersService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new PartnersService(prisma as unknown as PrismaService, audit);
  });

  it('moves NEW → CONTACTED and audits with from/to metadata', async () => {
    prisma.partnerLead.findFirst.mockResolvedValue(makeLead({ status: 'NEW' }));
    prisma.partnerLead.update.mockImplementation(({ data }) =>
      Promise.resolve(makeLead({ status: data.status })),
    );

    await expect(
      service.changeStatus('lead-1', { status: 'CONTACTED' }, admin),
    ).resolves.toMatchObject({ status: 'CONTACTED' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'partner_lead.status_changed',
        metadata: expect.objectContaining({ from: 'NEW', to: 'CONTACTED' }),
      }),
    );
  });

  it('rejects WON without actualCommissionCents (400) and does not persist', async () => {
    prisma.partnerLead.findFirst.mockResolvedValue(
      makeLead({ status: 'QUOTED' }),
    );
    await expect(
      service.changeStatus('lead-1', { status: 'WON' }, admin),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.partnerLead.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('accepts WON with amount ≥ 0 and stores the realized commission', async () => {
    prisma.partnerLead.findFirst.mockResolvedValue(
      makeLead({ status: 'QUOTED' }),
    );
    prisma.partnerLead.update.mockImplementation(({ data }) =>
      Promise.resolve(makeLead({ status: data.status, ...data })),
    );

    await expect(
      service.changeStatus(
        'lead-1',
        { status: 'WON', actualCommissionCents: 18_500 },
        admin,
      ),
    ).resolves.toMatchObject({ status: 'WON', actualCommissionCents: 18_500 });
  });

  it('treats LOST as terminal', async () => {
    prisma.partnerLead.findFirst.mockResolvedValue(makeLead({ status: 'LOST' }));
    await expect(
      service.changeStatus('lead-1', { status: 'NEW' }, admin),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.changeStatus('lead-1', { status: 'WON', actualCommissionCents: 1 }, admin),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.partnerLead.update).not.toHaveBeenCalled();
  });
});

describe('PartnersService.remove', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: AuditService;
  let service: PartnersService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = auditStub();
    service = new PartnersService(prisma as unknown as PrismaService, audit);
  });

  it('deletes only NEW leads and audits the deletion', async () => {
    prisma.partnerLead.findFirst.mockResolvedValue(makeLead({ status: 'NEW' }));

    await service.remove('lead-1', admin);

    expect(prisma.partnerLead.delete).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'partner_lead.deleted' }),
    );
  });

  it('refuses to delete leads already in the pipeline', async () => {
    for (const status of ['CONTACTED', 'QUOTED', 'WON', 'LOST']) {
      prisma.partnerLead.findFirst.mockResolvedValue(makeLead({ status }));
      await expect(service.remove('lead-1', admin)).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(prisma.partnerLead.delete).not.toHaveBeenCalled();
  });
});

describe('PartnersService.summary', () => {
  it('aggregates won commissions per category and month for the year', async () => {
    const prisma = makePrisma();
    const seededLeads = [
      makeLead({
        category: 'INSURANCE',
        actualCommissionCents: 10_000,
        createdAt: new Date('2026-01-15T00:00:00.000Z'),
      }),
      makeLead({
        id: 'lead-2',
        category: 'INSURANCE',
        actualCommissionCents: 5_500,
        createdAt: new Date('2026-01-20T00:00:00.000Z'),
      }),
      makeLead({
        id: 'lead-3',
        category: 'ELEVATOR',
        actualCommissionCents: 7_000,
        createdAt: new Date('2026-03-02T00:00:00.000Z'),
      }),
      // Won outside the requested window must not leak in.
      makeLead({
        id: 'lead-old',
        category: 'ENERGY',
        actualCommissionCents: 999,
        createdAt: new Date('2025-12-31T23:59:59.999Z'),
      }),
    ];
    // The mock must honor the year window the service queries with.
    prisma.partnerLead.findMany.mockImplementation(async (args) =>
      seededLeads.filter((lead) => {
        const range = (args?.where?.createdAt ?? {}) as { gte?: Date; lt?: Date };
        if (range.gte && lead.createdAt < range.gte) return false;
        if (range.lt && lead.createdAt >= range.lt) return false;
        return true;
      }),
    );
    const service = new PartnersService(
      prisma as unknown as PrismaService,
      auditStub(),
    );

    await expect(service.summary('building-1', admin, 2026)).resolves.toEqual({
      byCategory: [
        { category: 'INSURANCE', wonCount: 2, commissionCents: 15_500 },
        { category: 'ELEVATOR', wonCount: 1, commissionCents: 7_000 },
      ],
      byMonth: [
        { month: '2026-01', commissionCents: 15_500 },
        { month: '2026-03', commissionCents: 7_000 },
      ],
      totalWonCents: 22_500,
    });

    const where = prisma.partnerLead.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('WON');
    expect((where.createdAt.gte as Date).getUTCFullYear()).toBe(2026);
  });

  it('defaults to the current UTC year and returns empty buckets', async () => {
    const prisma = makePrisma();
    prisma.partnerLead.findMany.mockResolvedValue([]);
    const service = new PartnersService(
      prisma as unknown as PrismaService,
      auditStub(),
    );

    await expect(service.summary('building-1', admin)).resolves.toEqual({
      byCategory: [],
      byMonth: [],
      totalWonCents: 0,
    });
  });
});
