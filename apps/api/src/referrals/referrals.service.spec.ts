import { BadRequestException } from '@nestjs/common';

import { ReferralsService, generateReferralCode } from './referrals.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const admin = {
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-new',
} as unknown as AuthenticatedUser;

function makePrisma() {
  const prisma = {
    building: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    referralCredit: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(({ data }) => Promise.resolve({ id: 'credit-new', ...data })),
    },
    $transaction: jest.fn(),
  };
  return prisma;
}

function makeService(prisma = makePrisma()) {
  const audit = { record: jest.fn() };
  const service = new ReferralsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, audit, prisma };
}

describe('ReferralsService', () => {
  describe('generateReferralCode', () => {
    it('produces BLD-XXXXXX codes from the unambiguous alphabet', () => {
      for (let i = 0; i < 50; i += 1) {
        expect(generateReferralCode()).toMatch(/^BLD-[A-HJ-NP-Z2-9]{6}$/);
      }
    });
  });

  describe('ensureCode', () => {
    it('returns the stored code without writing (idempotent)', async () => {
      const { service, prisma } = makeService();
      prisma.building.findUnique.mockResolvedValue({
        id: 'building-1',
        referralCode: 'BLD-ABC234',
      });

      await expect(service.ensureCode('building-1')).resolves.toBe(
        'BLD-ABC234',
      );
      expect(prisma.building.update).not.toHaveBeenCalled();
    });

    it('generates, persists and audits a code when missing', async () => {
      const { service, audit, prisma } = makeService();
      prisma.building.findUnique.mockResolvedValue({
        id: 'building-1',
        referralCode: null,
      });
      prisma.building.update.mockImplementation(({ data }) => ({
        ...data,
      }));

      const code = await service.ensureCode('building-1');
      expect(code).toMatch(/^BLD-[A-HJ-NP-Z2-9]{6}$/);
      expect(prisma.building.update).toHaveBeenCalledWith({
        where: { id: 'building-1' },
        data: { referralCode: code },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'referral.code.created' }),
      );
    });

    it('retries on unique conflicts and eventually throws after repeated failures', async () => {
      const { service, prisma } = makeService();
      prisma.building.findUnique.mockResolvedValue({
        id: 'building-1',
        referralCode: null,
      });
      prisma.building.update.mockRejectedValue({ code: 'P2002' });

      await expect(service.ensureCode('building-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.building.update).toHaveBeenCalledTimes(8);
    });
  });

  describe('rotateCode', () => {
    it('stores and returns a fresh code', async () => {
      const { service, audit, prisma } = makeService();
      prisma.building.findUnique.mockResolvedValue({
        id: 'building-new',
        referralCode: 'BLD-OLD123',
      });
      prisma.building.update.mockImplementation(({ data }) => ({ ...data }));

      const result = await service.rotateCode('building-new', admin);

      expect(result.code).toMatch(/^BLD-[A-HJ-NP-Z2-9]{6}$/);
      expect(result.code).not.toBe('BLD-OLD123');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'referral.code.rotated' }),
      );
    });
  });

  describe('grantReferralRewards', () => {
    const code = 'BLD-ABC234';

    function happyPrisma() {
      const prisma = makePrisma();
      // Code owner lookup.
      prisma.building.findUnique.mockResolvedValue({ id: 'building-owner' });
      // No prior reward for the referred building.
      prisma.referralCredit.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (rows) => rows);
      return prisma;
    }

    it('grants 3 REFERRED months to the new building + 1 REFERRER month to the owner', async () => {
      const { service, audit, prisma } = makeService(happyPrisma());

      const result = await service.grantReferralRewards('building-new', code.toLowerCase());

      expect(result).toEqual({ granted: true });
      const createdData = prisma.referralCredit.create.mock.calls.map(
        ([q]) =>
          (q as { data: { reason: string; code: string; buildingId: string; sourceBuildingId: string | null } })
            .data,
      );
      const referred = createdData.filter((d) => d.reason === 'REFERRED');
      const referrer = createdData.filter((d) => d.reason === 'REFERRER');
      expect(referred).toHaveLength(3);
      expect(referrer).toHaveLength(1);
      expect(referred[0]).toEqual({
        reason: 'REFERRED',
        code,
        buildingId: 'building-new',
        sourceBuildingId: 'building-owner',
      });
      expect(referrer[0].buildingId).toBe('building-owner');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'referral.reward.granted' }),
      );
    });

    it('is idempotent: the second registration with the same code grants nothing', async () => {
      const prisma = happyPrisma();
      prisma.referralCredit.findFirst.mockResolvedValue({ id: 'existing' });
      const { service, audit } = makeService(prisma);

      const result = await service.grantReferralRewards('building-new', code);

      expect(result).toEqual({ granted: false, reason: 'ALREADY_REFERRED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'referral.reward.granted' }),
      );
    });

    it('rejects self-referrals', async () => {
      const prisma = happyPrisma();
      prisma.building.findUnique.mockResolvedValue({ id: 'building-new' });
      const { service } = makeService(prisma);

      const result = await service.grantReferralRewards('building-new', code);

      expect(result).toEqual({ granted: false, reason: 'SELF_REFERRAL' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignores malformed and unknown codes without throwing', async () => {
      const { service } = makeService();

      expect(await service.grantReferralRewards('b-new', 'NOT-A-CODE')).toEqual(
        { granted: false, reason: 'INVALID_CODE' },
      );

      const unknown = makePrisma();
      unknown.building.findUnique.mockResolvedValue(null);
      const svc = makeService(unknown).service;
      expect(await svc.grantReferralRewards('b-new', code)).toEqual({
        granted: false,
        reason: 'INVALID_CODE',
      });
      expect(unknown.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('info / listCredits', () => {
    it('returns the code, url base and credit list with ISO timestamps', async () => {
      const { service, prisma } = makeService();
      prisma.building.findUnique.mockResolvedValue({
        id: 'b1',
        referralCode: 'BLD-ZZZ999',
      });
      prisma.referralCredit.findMany.mockResolvedValue([
        {
          id: 'c1',
          buildingId: 'b1',
          sourceBuildingId: 'owner',
          code: 'BLD-ZZZ999',
          months: 1,
          reason: 'REFERRER',
          usedAt: new Date('2026-08-01T00:00:00Z'),
          usedPeriod: '2026-08',
          createdAt: new Date('2026-07-01T00:00:00Z'),
        },
      ]);

      const info = await service.info('b1', {
        ...admin,
        buildingId: 'b1',
      } as unknown as AuthenticatedUser);

      expect(info.code).toBe('BLD-ZZZ999');
      expect(info.referralUrlBase).toMatch(/\/register$/);
      expect(info.credits[0]).toEqual(
        expect.objectContaining({
          id: 'c1',
          usedAt: '2026-08-01T00:00:00.000Z',
          usedPeriod: '2026-08',
        }),
      );
    });
  });
});
