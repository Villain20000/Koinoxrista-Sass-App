import {
  BadRequestException,
  ConflictException,
  GoneException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { Mailer } from '../reminders/mailer';
import {
  OpenRegistrationService,
  hashEmailToken,
} from './open-registration.service';

const rawToken = 'abcdef0123456789abcdef0123456789';

function buildService(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const buildingFindFirst = overrides.buildingFindFirst ?? jest.fn();
  const userFindUnique = overrides.userFindUnique ?? jest.fn();
  const transaction = overrides.transaction ?? jest.fn();
  const userUpdate = overrides.userUpdate ?? jest.fn();
  const emailVerificationFindUnique = overrides.emailVerificationFindUnique ?? jest.fn();
  const emailVerificationUpdate = overrides.emailVerificationUpdate ?? jest.fn();
  const ownershipFindFirst = overrides.ownershipFindFirst ?? jest.fn();
  const membershipUpsert = overrides.membershipUpsert ?? jest.fn();

  const prisma = {
    building: { findFirst: buildingFindFirst },
    user: { findUnique: userFindUnique, update: userUpdate },
    emailVerification: {
      findUnique: emailVerificationFindUnique,
      update: emailVerificationUpdate,
    },
    ownership: { findFirst: ownershipFindFirst },
    membership: { upsert: membershipUpsert },
    $transaction: transaction,
  };
  const mailer = { send: jest.fn() } as unknown as Mailer;
  const audit = { record: jest.fn() } as unknown as import('../audit/audit.service').AuditService;
  return {
    service: new OpenRegistrationService(
      prisma as unknown as PrismaService,
      audit,
      mailer,
    ),
    mocks: {
      buildingFindFirst,
      userFindUnique,
      transaction,
      userUpdate,
      emailVerificationFindUnique,
      emailVerificationUpdate,
      ownershipFindFirst,
      membershipUpsert,
      mailer,
    },
  };
}

describe('OpenRegistrationService', () => {
  describe('registerOpen', () => {
    it('rejects an unknown building code', async () => {
      const { service, mocks } = buildService();
      mocks.buildingFindFirst.mockResolvedValue(null);

      await expect(
        service.registerOpen({
          email: 'a@b.gr',
          password: 'Passw0rd!',
          firstName: 'A',
          lastName: 'B',
          buildingCode: 'ABCDEF12',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-registered email', async () => {
      const { service, mocks } = buildService();
      mocks.buildingFindFirst.mockResolvedValue({ id: 'b1', joinCode: 'ABCDEF12' });
      mocks.userFindUnique.mockResolvedValue({ id: 'u1' });

      await expect(
        service.registerOpen({
          email: 'a@b.gr',
          password: 'Passw0rd!',
          firstName: 'A',
          lastName: 'B',
          buildingCode: 'ABCDEF12',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a PENDING_VERIFICATION user + verification row and mails the link', async () => {
      const { service, mocks } = buildService();
      mocks.buildingFindFirst.mockResolvedValue({ id: 'b1', joinCode: 'ABCDEF12' });
      mocks.userFindUnique.mockResolvedValue(null);
      mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'u-new',
              email: 'a@b.gr',
              status: 'PENDING_VERIFICATION',
            }),
          },
          emailVerification: { create: jest.fn().mockResolvedValue({}) },
        };
        return fn(tx);
      });

      const result = await service.registerOpen({
        email: 'a@b.gr',
        password: 'Passw0rd!',
        firstName: 'A',
        lastName: 'B',
        buildingCode: 'ABCDEF12',
      });

      expect(result.status).toBe('PENDING_VERIFICATION');
      expect(mocks.mailer.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyEmail', () => {
    const verifyRow = () => ({
      id: 'v1',
      userId: 'u1',
      buildingId: 'b1',
      tokenHash: hashEmailToken(rawToken),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
      user: { id: 'u1', email: 'a@b.gr' },
    });

    it('activates and auto-binds an owner-of-record email', async () => {
      const { service, mocks } = buildService();
      mocks.emailVerificationFindUnique.mockResolvedValue(verifyRow());
      mocks.ownershipFindFirst.mockResolvedValue({ id: 'own1', unitId: 'unit1' });
      mocks.userUpdate.mockResolvedValue({ id: 'u1', email: 'a@b.gr', status: 'ACTIVE' });
      mocks.membershipUpsert.mockResolvedValue({});

      const result = await service.verifyEmail(rawToken);
      expect(result.status).toBe('ACTIVE');
      expect(mocks.userUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'ACTIVE' } }),
      );
    });

    it('lands in PENDING_APPROVAL when the email is not on the ownership list', async () => {
      const { service, mocks } = buildService();
      mocks.emailVerificationFindUnique.mockResolvedValue(verifyRow());
      mocks.ownershipFindFirst.mockResolvedValue(null);
      mocks.userUpdate.mockResolvedValue({ id: 'u1', email: 'a@b.gr', status: 'PENDING_APPROVAL' });
      mocks.membershipUpsert.mockResolvedValue({});

      const result = await service.verifyEmail(rawToken);
      expect(result.status).toBe('PENDING_APPROVAL');
    });

    it('throws GoneException for a consumed or invalid token', async () => {
      const { service, mocks } = buildService();
      mocks.emailVerificationFindUnique.mockResolvedValue(null);
      await expect(service.verifyEmail('nope')).rejects.toThrow(GoneException);
    });
  });
});