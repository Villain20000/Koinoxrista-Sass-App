import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  TenancyService,
  filterEligiblePool,
  computeEligibleTallyPure,
} from './tenancy.service';

const admin = (overrides: Partial<any> = {}) => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: Role.ADMIN as any,
  buildingId: 'building-1',
  ...overrides,
});

function makePrisma() {
  return {
    unit: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    ownership: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { shareMillimes: 0 } }),
    },
    votingEligibilityRule: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    vote: {
      findUnique: jest.fn(),
    },
    ballot: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('TenancyService', () => {
  let service: TenancyService;
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { record: jest.Mock };

  beforeEach(() => {
    prisma = makePrisma();
    audit = { record: jest.fn() };
    service = new TenancyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );

    prisma.unit.findUnique.mockResolvedValue({
      id: 'unit-a',
      buildingId: 'building-1',
      label: 'Α1',
      millimes: 300,
    } as any);
    prisma.user.findUnique.mockResolvedValue({
      id: 'resident-1',
      buildingId: 'building-1',
    } as any);
    prisma.ownership.create.mockImplementation(async ({ data }: any) => ({
      id: 'own-1',
      unitId: data.unitId,
      userId: data.userId,
      shareMillimes: data.shareMillimes,
      occupantType: data.occupantType,
      votingEligible: data.votingEligible,
      residentRole: data.residentRole ?? null,
      periodStart: data.periodStart ?? null,
    }));
    prisma.ownership.update.mockImplementation(async ({ data }: any) => ({
      id: 'own-1',
      unitId: 'unit-a',
      userId: 'resident-1',
      shareMillimes: 100,
      occupantType: data.occupantType ?? 'OWNER',
      votingEligible: data.votingEligible ?? true,
      residentRole: data.residentRole ?? null,
    }));
    prisma.ownership.findMany.mockResolvedValue([]);
    prisma.vote.findUnique.mockResolvedValue({
      id: 'vote-1',
      buildingId: 'building-1',
      thresholdType: 'MILLIMES_MAJORITY',
    } as any);
    prisma.votingEligibilityRule.findMany.mockResolvedValue([]);
    prisma.votingEligibilityRule.findFirst.mockResolvedValue(null);
  });

  describe('setOccupancy', () => {
    it('creates an OWNER occupancy with votingEligible true and audits', async () => {
      prisma.ownership.findFirst.mockResolvedValue(null);
      prisma.ownership.create.mockResolvedValue({
        id: 'own-1',
        unitId: 'unit-a',
        userId: 'resident-1',
        shareMillimes: 150,
        occupantType: 'OWNER',
        votingEligible: true,
        residentRole: null,
      } as any);

      const result = await service.setOccupancy(
        'building-1',
        'unit-a',
        {
          userId: 'resident-1',
          occupantType: 'OWNER',
          votingEligible: true,
        } as any,
        admin(),
      );

      expect(result.occupantType).toBe('OWNER');
      expect(result.votingEligible).toBe(true);
      expect(prisma.ownership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            occupantType: 'OWNER',
            votingEligible: true,
          }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenancy.occupancy.set',
          entity: 'ownership',
        }),
      );
    });

    it('updates existing TENANT occupancy and toggles votingEligible', async () => {
      prisma.ownership.findFirst.mockResolvedValue({
        id: 'own-1',
        unitId: 'unit-a',
        userId: 'resident-1',
        occupantType: 'OWNER',
        votingEligible: true,
      } as any);
      prisma.ownership.update.mockResolvedValue({
        id: 'own-1',
        unitId: 'unit-a',
        userId: 'resident-1',
        shareMillimes: 100,
        occupantType: 'TENANT',
        votingEligible: false,
        residentRole: 'TENANT',
      } as any);

      const result = await service.setOccupancy(
        'building-1',
        'unit-a',
        {
          userId: 'resident-1',
          occupantType: 'TENANT',
          votingEligible: false,
          residentRole: 'TENANT',
        } as any,
        admin(),
      );

      expect(result.occupantType).toBe('TENANT');
      expect(result.votingEligible).toBe(false);
      expect(result.residentRole).toBe('TENANT');
      expect(prisma.ownership.update).toHaveBeenCalled();
    });

    it('links building-less user to building on create', async () => {
      prisma.ownership.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'resident-2',
        buildingId: null,
      } as any);

      await service.setOccupancy(
        'building-1',
        'unit-a',
        { userId: 'resident-2', occupantType: 'OWNER' } as any,
        admin(),
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'resident-2' },
        data: { buildingId: 'building-1' },
      });
    });

    it('enforces tenant isolation for building', async () => {
      await expect(
        service.setOccupancy(
          'building-2',
          'unit-a',
          { userId: 'resident-1', occupantType: 'OWNER' } as any,
          admin({ buildingId: 'building-1' }),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.ownership.create).not.toHaveBeenCalled();
    });

    it('rejects occupantType not in OWNER/TENANT', async () => {
      await expect(
        service.setOccupancy(
          'building-1',
          'unit-a',
          { userId: 'resident-1', occupantType: 'GUEST' as any } as any,
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects user from another building', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'foreign',
        buildingId: 'building-9',
      } as any);
      await expect(
        service.setOccupancy(
          'building-1',
          'unit-a',
          { userId: 'foreign', occupantType: 'OWNER' } as any,
          admin(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound for unknown unit or user', async () => {
      prisma.unit.findUnique.mockResolvedValue(null);
      await expect(
        service.setOccupancy(
          'building-1',
          'ghost',
          { userId: 'resident-1', occupantType: 'OWNER' } as any,
          admin(),
        ),
      ).rejects.toThrow(NotFoundException);

      prisma.unit.findUnique.mockResolvedValue({
        id: 'unit-a',
        buildingId: 'building-1',
        millimes: 300,
      } as any);
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.setOccupancy(
          'building-1',
          'unit-a',
          { userId: 'ghost', occupantType: 'OWNER' } as any,
          admin(),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getUnitOccupants', () => {
    it('lists occupants with normalized occupantType', async () => {
      prisma.ownership.findMany.mockResolvedValue([
        {
          id: 'own-1',
          unitId: 'unit-a',
          userId: 'r1',
          shareMillimes: 100,
          occupantType: 'TENANT',
          votingEligible: false,
          residentRole: 'TENANT',
          user: { firstName: 'N', lastName: 'P', email: 'n@p.gr' },
        },
      ] as any);

      const rows = await service.getUnitOccupants(
        'building-1',
        'unit-a',
        admin(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].occupantType).toBe('TENANT');
      expect(rows[0].votingEligible).toBe(false);
    });

    it('enforces building boundary', async () => {
      await expect(
        service.getUnitOccupants('building-2', 'unit-a', admin()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws for foreign unit', async () => {
      prisma.unit.findUnique.mockResolvedValue({
        id: 'unit-a',
        buildingId: 'building-9',
        millimes: 100,
      } as any);
      await expect(
        service.getUnitOccupants('building-1', 'unit-a', admin()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('eligibility rules', () => {
    it('creates and then updates a GENERAL rule with deduped allowedTypes', async () => {
      prisma.votingEligibilityRule.findFirst.mockResolvedValue(null);
      prisma.votingEligibilityRule.create.mockResolvedValue({
        id: 'rule-1',
        buildingId: 'building-1',
        category: 'GENERAL',
        allowedTypes: ['OWNER'],
        requiresMillimes: true,
        createdAt: new Date(),
      } as any);

      const created = await service.upsertRule(
        'building-1',
        { category: 'GENERAL', allowedTypes: ['OWNER'], requiresMillimes: true } as any,
        admin(),
      );
      expect(created.category).toBe('GENERAL');
      expect(created.allowedTypes).toEqual(['OWNER']);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenancy.rule.upsert' }),
      );

      prisma.votingEligibilityRule.findFirst.mockResolvedValue({
        id: 'rule-1',
        buildingId: 'building-1',
        category: 'GENERAL',
        allowedTypes: ['OWNER'],
        requiresMillimes: true,
      } as any);
      prisma.votingEligibilityRule.update.mockResolvedValue({
        id: 'rule-1',
        buildingId: 'building-1',
        category: 'GENERAL',
        allowedTypes: ['OWNER', 'TENANT'],
        requiresMillimes: false,
        createdAt: new Date(),
      } as any);

      const updated = await service.upsertRule(
        'building-1',
        {
          category: 'GENERAL',
          allowedTypes: ['OWNER', 'TENANT', 'OWNER'],
          requiresMillimes: false,
        } as any,
        admin(),
      );
      expect(updated.allowedTypes).toEqual(['OWNER', 'TENANT']);
      expect(updated.requiresMillimes).toBe(false);
    });

    it('rejects empty allowedTypes or invalid category', async () => {
      await expect(
        service.upsertRule(
          'building-1',
          { category: 'GENERAL', allowedTypes: [] } as any,
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsertRule(
          'building-1',
          { category: 'RANDOM' as any, allowedTypes: ['OWNER'] } as any,
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces tenant isolation on getEligibilityRules', async () => {
      await expect(
        service.getEligibilityRules('building-9', admin()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('checkCanVote', () => {
    it('allows OWNER when rule allows OWNER, denies TENANT', async () => {
      prisma.ownership.findMany.mockResolvedValue([
        { id: 'o1', unitId: 'unit-a', occupantType: 'OWNER', votingEligible: true } as any,
      ]);
      prisma.votingEligibilityRule.findMany.mockResolvedValue([
        {
          id: 'r1',
          buildingId: 'building-1',
          category: 'GENERAL',
          allowedTypes: ['OWNER'],
          requiresMillimes: true,
        } as any,
      ]);

      const ok = await service.checkCanVote(
        'building-1',
        'vote-1',
        'unit-a',
        admin(),
      );
      expect(ok.eligible).toBe(true);
      expect(ok.reason).toBe('ELIGIBLE');

      prisma.ownership.findMany.mockResolvedValue([
        { id: 'o2', unitId: 'unit-a', occupantType: 'TENANT', votingEligible: true } as any,
      ]);
      const denied = await service.checkCanVote(
        'building-1',
        'vote-1',
        'unit-a',
        admin(),
      );
      expect(denied.eligible).toBe(false);
      expect(denied.reason).toBe('OCCUPANT_TYPE_NOT_ALLOWED');
    });

    it('denies when votingEligible is false even if type allowed', async () => {
      prisma.ownership.findMany.mockResolvedValue([
        { occupantType: 'OWNER', votingEligible: false } as any,
      ]);
      prisma.votingEligibilityRule.findMany.mockResolvedValue([
        { category: 'GENERAL', allowedTypes: ['OWNER', 'TENANT'], requiresMillimes: true } as any,
      ]);
      const res = await service.checkCanVote(
        'building-1',
        'vote-1',
        'unit-a',
        admin(),
      );
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('NOT_VOTING_ELIGIBLE');
    });

    it('denies NO_OCCUPANT when no ownership', async () => {
      prisma.ownership.findMany.mockResolvedValue([]);
      const res = await service.checkCanVote(
        'building-1',
        'vote-1',
        'unit-a',
        admin(),
      );
      expect(res.eligible).toBe(false);
      expect(res.reason).toBe('NO_OCCUPANT');
    });

    it('uses FINANCIAL rule for MILLIMES_MAJORITY votes', async () => {
      prisma.vote.findUnique.mockResolvedValue({
        id: 'vote-1',
        buildingId: 'building-1',
        thresholdType: 'MILLIMES_MAJORITY',
      } as any);
      prisma.ownership.findMany.mockResolvedValue([
        { occupantType: 'TENANT', votingEligible: true } as any,
      ]);
      prisma.votingEligibilityRule.findMany.mockResolvedValue([
        { category: 'GENERAL', allowedTypes: ['OWNER'], requiresMillimes: true } as any,
        { category: 'FINANCIAL', allowedTypes: ['OWNER', 'TENANT'], requiresMillimes: true } as any,
      ]);
      const res = await service.checkCanVote(
        'building-1',
        'vote-1',
        'unit-a',
        admin(),
      );
      expect(res.eligible).toBe(true);
      expect(res.ruleCategory).toBe('FINANCIAL');
    });

    it('blocks foreign building access', async () => {
      await expect(
        service.checkCanVote('building-9', 'vote-1', 'unit-a', admin()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('computeEligibleTally (pure + service)', () => {
    it('pure helper filters tenant ballots when rule allows only OWNER', () => {
      const ballots = [
        { unitId: 'unit-a', choice: 'YES' },
        { unitId: 'unit-b', choice: 'YES' },
        { unitId: 'unit-c', choice: 'NO' },
      ];
      const units = [
        { id: 'unit-a', millimes: 500 },
        { id: 'unit-b', millimes: 300 },
        { id: 'unit-c', millimes: 200 },
      ];
      const ownershipByUnit = new Map<string, any>([
        ['unit-a', { occupantType: 'OWNER', votingEligible: true }],
        ['unit-b', { occupantType: 'TENANT', votingEligible: true }],
        ['unit-c', { occupantType: 'OWNER', votingEligible: true }],
      ]);
      const rule = { allowedTypes: ['OWNER'], requiresMillimes: true };

      const tally = computeEligibleTallyPure(
        'MILLIMES_MAJORITY',
        ballots,
        units,
        ownershipByUnit,
        rule,
      );
      // Only unit-a and unit-c are eligible: YES 500 vs NO 200 => PASSED (700 eligible millimes total, 500 > 350)
      expect(tally.yesMillimes).toBe(500);
      expect(tally.noMillimes).toBe(200);
      expect(tally.totalMillimes).toBe(700);
      expect(tally.outcome).toBe('PASSED');
      // Tenant's 300 millimes ballot ignored
      expect(tally.yesCount).toBe(1);
    });

    it('service computeEligibleTally weights only eligible and respects HEADCOUNT alias', async () => {
      prisma.vote.findUnique.mockResolvedValue({
        id: 'vote-1',
        buildingId: 'building-1',
        thresholdType: 'HEADCOUNT',
      } as any);
      prisma.unit.findMany.mockResolvedValue([
        { id: 'unit-a', millimes: 500 },
        { id: 'unit-b', millimes: 300 },
        { id: 'unit-c', millimes: 200 },
      ] as any);
      prisma.ballot.findMany.mockResolvedValue([
        { unitId: 'unit-a', choice: 'YES' },
        { unitId: 'unit-b', choice: 'YES' },
        { unitId: 'unit-c', choice: 'NO' },
      ] as any);
      (prisma as any).ownership.findMany = jest.fn().mockResolvedValue([
        { unitId: 'unit-a', occupantType: 'OWNER', votingEligible: true },
        { unitId: 'unit-b', occupantType: 'TENANT', votingEligible: true },
        { unitId: 'unit-c', occupantType: 'OWNER', votingEligible: true },
      ] as any);
      prisma.votingEligibilityRule.findMany.mockResolvedValue([
        { category: 'GENERAL', allowedTypes: ['OWNER'], requiresMillimes: false } as any,
      ]);

      const tally = await service.computeEligibleTally(
        'building-1',
        'vote-1',
        admin(),
      );
      // Eligible ballots: unit-a YES, unit-c NO => tie => REJECTED under SIMPLE_MAJORITY
      expect(tally.yesCount).toBe(1);
      expect(tally.noCount).toBe(1);
      expect(tally.outcome).toBe('REJECTED');
    });

    it('filterEligiblePool respects votingEligible flag', () => {
      const ballots = [{ unitId: 'unit-a', choice: 'YES' }];
      const units = [{ id: 'unit-a', millimes: 500 }];
      const ownershipByUnit = new Map([
        ['unit-a', { occupantType: 'OWNER', votingEligible: false }],
      ]);
      const { eligibleBallots, eligibleUnits } = filterEligiblePool(
        ballots,
        units,
        ownershipByUnit,
        { allowedTypes: ['OWNER'], requiresMillimes: true },
      );
      expect(eligibleBallots).toHaveLength(0);
      expect(eligibleUnits).toHaveLength(0);
    });

    it('enforces tenant boundary on tally', async () => {
      await expect(
        service.computeEligibleTally('building-9', 'vote-1', admin()),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
