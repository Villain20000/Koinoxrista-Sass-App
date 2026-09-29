import { BadRequestException } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';

import { TwoFactorService } from './two-factor.service';
import { generateSecret, totpAt } from './totp';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const makeUser = (
  overrides: Partial<User> & Record<string, unknown> = {},
): User =>
  ({
    id: 'user-1',
    email: 'admin@demo.gr',
    passwordHash: bcrypt.hashSync('Admin1234!', 10),
    firstName: 'Nikos',
    lastName: 'Papadopoulos',
    phone: null,
    role: Role.ADMIN,
    buildingId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }) as User;

describe('TwoFactorService', () => {
  let service: TwoFactorService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    twoFactorRecoveryCode: {
      create: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let audit: { record: jest.Mock };

  beforeEach(() => {
    jest.restoreAllMocks();
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      twoFactorRecoveryCode: {
        create: jest.fn().mockResolvedValue({ id: 'rc', codeHash: 'h' }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 10 }),
      },
    };
    audit = { record: jest.fn() };
    service = new TwoFactorService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('isEnabled', () => {
    it('reflects the user column (pending fragment field)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: true }),
      );
      await expect(service.isEnabled('user-1')).resolves.toBe(true);

      prisma.user.findUnique.mockResolvedValue(
        makeUser({ twoFactorEnabled: false }),
      );
      await expect(service.isEnabled('user-1')).resolves.toBe(false);
    });
  });

  describe('setup', () => {
    it('returns a fresh base32 secret and a QR-scannable otpauth URI', () => {
      const { secret, otpauthUri } = service.setup('admin@demo.gr');

      expect(secret).toMatch(/^[A-Z2-7]{26,}$/);
      expect(otpauthUri).toContain(`secret=${secret}`);
      expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(otpauthUri).toContain('admin%40demo.gr');
      // Nothing persisted yet — setup alone must not activate 2FA.
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('enable', () => {
    const secret = generateSecret();

    it('verifies a live code, enables 2FA and issues 10 hashed recovery codes once', async () => {
      const token = totpAt(secret, Date.now());

      const codes = await service.enable('user-1', secret, token);

      expect(codes).toHaveLength(10);
      for (const code of codes) {
        expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
      }
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          twoFactorSecret: secret.toUpperCase(),
          twoFactorEnabled: true,
        }),
      });
      // Old codes wiped, then one hash per new code stored — never plaintext.
      expect(prisma.twoFactorRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      const hashes = prisma.twoFactorRecoveryCode.create.mock.calls.map(
        ([call]: [{ data: { codeHash: string } }]) => call.data.codeHash,
      );
      expect(hashes).toHaveLength(10);
      for (let i = 0; i < codes.length; i++) {
        expect(hashes[i]).toBe(sha256Hex(codes[i].replace('-', '')));
        expect(hashes[i]).not.toContain(codes[i]);
      }
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.2fa.enabled' }),
      );
    });

    it('accepts lowercase or padded secrets but stores them normalized', async () => {
      const codes = await service.enable(
        'user-1',
        secret.toLowerCase(),
        totpAt(secret, Date.now()),
      );
      expect(codes).toHaveLength(10);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({ twoFactorSecret: secret }),
      });
    });

    it('rejects a wrong code with 400 and persists nothing', async () => {
      await expect(service.enable('user-1', secret, '000000')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.twoFactorRecoveryCode.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rejects malformed secrets with 400', async () => {
      await expect(service.enable('user-1', 'has!bang', '123456')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('disable', () => {
    it('requires the current password', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(
        service.disable('user-1', 'WrongPass1'),
      ).rejects.toMatchObject({ status: 401, message: 'Invalid password' });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('wipes secret + codes and audits on success', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await service.disable('user-1', 'Admin1234!');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { twoFactorSecret: null, twoFactorEnabled: false },
      });
      expect(prisma.twoFactorRecoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.2fa.disabled' }),
      );
    });
  });

  describe('verifyLoginCode', () => {
    it('accepts a current TOTP code without touching recovery codes', async () => {
      const secret = generateSecret();
      const user = makeUser({ twoFactorSecret: secret });

      await expect(
        service.verifyLoginCode(user, totpAt(secret, Date.now())),
      ).resolves.toBe(true);
      expect(prisma.twoFactorRecoveryCode.findMany).not.toHaveBeenCalled();
    });

    it('falls back to an unused recovery code and consumes it atomically', async () => {
      const raw = 'ABCDE-FGH23';
      const user = makeUser({ twoFactorSecret: generateSecret() });
      prisma.twoFactorRecoveryCode.findMany.mockResolvedValue([
        { id: 'rc-other', codeHash: sha256Hex('ZZZZZ-ZZZZZ') },
        { id: 'rc-match', codeHash: sha256Hex(raw.replace('-', '')) },
      ]);

      // Lowercase + extra separators must normalize to the same hash.
      await expect(
        service.verifyLoginCode(user, 'abcde.fgh23'),
      ).resolves.toBe(true);
      expect(prisma.twoFactorRecoveryCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'rc-match', userId: 'user-1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('does NOT consume an already-used code lost in a race', async () => {
      const raw = 'ABCDEFGH23';
      const user = makeUser({ twoFactorSecret: generateSecret() });
      prisma.twoFactorRecoveryCode.findMany.mockResolvedValue([
        { id: 'rc-1', codeHash: sha256Hex(raw) },
      ]);
      prisma.twoFactorRecoveryCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.verifyLoginCode(user, raw)).resolves.toBe(false);
    });

    it('rejects unknown recovery codes', async () => {
      const user = makeUser({ twoFactorSecret: generateSecret() });
      prisma.twoFactorRecoveryCode.findMany.mockResolvedValue([
        { id: 'rc-1', codeHash: sha256Hex('AAAAAAAAAA') },
      ]);

      await expect(
        service.verifyLoginCode(user, 'BBBBBBBBBB'),
      ).resolves.toBe(false);
      expect(prisma.twoFactorRecoveryCode.updateMany).not.toHaveBeenCalled();
    });

    it('rejects garbage and users without a stored secret', async () => {
      const withSecret = makeUser({ twoFactorSecret: generateSecret() });
      await expect(
        service.verifyLoginCode(withSecret, 'nope'),
      ).resolves.toBe(false);
      await expect(
        service.verifyLoginCode(withSecret, 'ABCDEFGHI'),
      ).resolves.toBe(false); // 9 chars

      const withoutSecret = makeUser({});
      await expect(
        service.verifyLoginCode(withoutSecret, '123456'),
      ).resolves.toBe(false);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
