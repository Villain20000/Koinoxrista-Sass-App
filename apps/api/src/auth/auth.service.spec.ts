import './test-env';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

import {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
} from './auth.types';
import { AuthService } from './auth.service';
import { TwoFactorChallenge } from './auth.service';
import {
  signLoginTicket,
  verifyLoginTicket,
} from '../two-factor/login-ticket';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { generateSecret } from '../two-factor/totp';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from '../sessions/sessions.service';

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'resident01@demo.gr',
  passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
  firstName: 'Nikos',
  lastName: 'Papadopoulos',
  phone: null,
  role: Role.RESIDENT,
  buildingId: 'building-1',
  twoFactorSecret: null,
  twoFactorEnabled: false,
  status: 'ACTIVE',
  locale: 'ja',
  pointBalance: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const makeInvite = (overrides: Record<string, unknown> = {}) => ({
  id: 'invite-1',
  email: 'new@demo.gr',
  role: Role.RESIDENT,
  buildingId: 'building-1',
  unitId: 'unit-1',
  tokenHash: createHash('sha256').update('raw-token', 'utf8').digest('hex'),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  acceptedAt: null,
  invitedById: 'admin-1',
  createdAt: new Date(),
  ...overrides,
});

/** User carrying the two pending fragment columns (client regen pending). */
const makeTwoFactorUser = (
  secret = generateSecret(),
): User & { twoFactorEnabled: boolean; twoFactorSecret: string } => ({
  ...makeUser(),
  twoFactorEnabled: true,
  twoFactorSecret: secret,
});

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let verifyLoginCode: jest.Mock;
  let sessions: {
    record: jest.Mock;
    rotate: jest.Mock;
    assertNotRevoked: jest.Mock;
  };
  let prisma: {
    user: { create: jest.Mock; findUnique: jest.Mock };
    invite: { findUnique: jest.Mock };
    accountantAccess: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      user: { create: jest.fn(), findUnique: jest.fn() },
      invite: { findUnique: jest.fn() },
      accountantAccess: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    jwtService = new JwtService();
    verifyLoginCode = jest.fn().mockResolvedValue(true);
    sessions = {
      record: jest.fn(),
      rotate: jest.fn(),
      assertNotRevoked: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(prisma as unknown as PrismaService, jwtService, {
      verifyLoginCode,
    } as unknown as TwoFactorService, sessions as unknown as SessionsService);
  });

  describe('register', () => {
    const dto = {
      email: 'new@demo.gr',
      password: 'Passw0rd!',
      firstName: 'Maria',
      lastName: 'Ioannou',
    };

    it('creates a RESIDENT user and returns id/email/role', async () => {
      prisma.user.create.mockResolvedValue(
        makeUser({
          email: dto.email,
          role: Role.RESIDENT,
          passwordHash: 'hashed',
        }),
      );

      const result = await service.register(dto);

      expect(result).toEqual({
        id: 'user-1',
        email: dto.email,
        role: Role.RESIDENT,
      });
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      const args = prisma.user.create.mock.calls[0][0];
      expect(args.data.role).toBe(Role.RESIDENT);
      expect(args.data.passwordHash).not.toBe(dto.password);
      expect(await bcrypt.compare(dto.password, args.data.passwordHash)).toBe(
        true,
      );
    });

    it('throws 409 on duplicate email (Prisma P2002)', async () => {
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          { code: 'P2002', clientVersion: '6.x' },
        ),
      );

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      await expect(service.register(dto)).rejects.toMatchObject({
        status: 409,
      });
    });

    it('rethrows non-P2002 errors', async () => {
      prisma.user.create.mockRejectedValue(new Error('db down'));
      await expect(service.register(dto)).rejects.toThrow('db down');
    });
  });

  describe('register with inviteToken', () => {
    const dto = {
      email: 'new@demo.gr',
      password: 'Passw0rd!',
      firstName: 'Maria',
      lastName: 'Ioannou',
      inviteToken: 'raw-token',
    };

    const makeTx = () => ({
      user: { create: jest.fn() },
      unit: { findUniqueOrThrow: jest.fn() },
      ownership: { create: jest.fn() },
      membership: { create: jest.fn() },
      invite: { update: jest.fn() },
    });

    const runTransactionWith = (tx: ReturnType<typeof makeTx>) => {
      prisma.$transaction.mockImplementation((fn: (t: unknown) => unknown) =>
        fn(tx),
      );
      return tx;
    };

    it('rejects an unknown token with 400 before creating any user', async () => {
      prisma.invite.findUnique.mockResolvedValue(null);

      await expect(service.register(dto)).rejects.toMatchObject({
        status: 400,
        message: 'Invalid invite token',
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.invite.findUnique).toHaveBeenCalledWith({
        where: {
          tokenHash: createHash('sha256').update('raw-token', 'utf8').digest('hex'),
        },
      });
    });

    it('rejects an already-used invite', async () => {
      prisma.invite.findUnique.mockResolvedValue(
        makeInvite({ acceptedAt: new Date() }),
      );

      await expect(service.register(dto)).rejects.toMatchObject({
        status: 400,
        message: 'Invite has already been used',
      });
    });

    it('rejects an expired invite', async () => {
      prisma.invite.findUnique.mockResolvedValue(
        makeInvite({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.register(dto)).rejects.toThrow(
        new BadRequestException('Invite has expired'),
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('provisions a RESIDENT invitee inside one transaction: role, building, ownership and acceptance', async () => {
      const invite = makeInvite();
      prisma.invite.findUnique.mockResolvedValue(invite);
      const tx = runTransactionWith(makeTx());
      tx.unit.findUniqueOrThrow.mockResolvedValue({
        id: 'unit-1',
        millimes: 125,
      });
      tx.user.create.mockResolvedValue(
        makeUser({ id: 'user-new', email: dto.email }),
      );

      const result = await service.register(dto);

      expect(result).toEqual({ id: 'user-new', email: dto.email, role: Role.RESIDENT });
      const createdData = tx.user.create.mock.calls[0][0].data;
      expect(createdData.role).toBe(Role.RESIDENT);
      expect(createdData.buildingId).toBe('building-1');
      expect(tx.ownership.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          unitId: 'unit-1',
          userId: 'user-new',
          shareMillimes: 125,
          periodStart: expect.any(Date),
        }),
      });
      expect(tx.membership.create).not.toHaveBeenCalled();
      expect(tx.invite.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { acceptedAt: expect.any(Date) },
      });
    });

    it('provisions an ADMIN invitee with a default membership and no ownership', async () => {
      const invite = makeInvite({ role: Role.ADMIN, unitId: null });
      prisma.invite.findUnique.mockResolvedValue(invite);
      const tx = runTransactionWith(makeTx());
      tx.user.create.mockResolvedValue(
        makeUser({ id: 'user-admin', email: dto.email, role: Role.ADMIN }),
      );

      const result = await service.register(dto);

      expect(result.role).toBe(Role.ADMIN);
      expect(tx.membership.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-admin',
          buildingId: 'building-1',
          role: Role.ADMIN,
          isDefault: true,
        },
      });
      expect(tx.ownership.create).not.toHaveBeenCalled();
      expect(tx.unit.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(tx.invite.update).toHaveBeenCalledTimes(1);
    });

    it('still maps duplicate-email P2002 to 409 during invited signup', async () => {
      const invite = makeInvite({ role: Role.ADMIN, unitId: null });
      prisma.invite.findUnique.mockResolvedValue(invite);
      const tx = runTransactionWith(makeTx());
      tx.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.x',
        }),
      );

      await expect(service.register(dto)).rejects.toMatchObject({
        status: 409,
        message: 'Email already registered',
      });
      expect(tx.invite.update).not.toHaveBeenCalled();
    });

    it('generates tokens that hash to their stored form (token scheme sanity)', () => {
      const raw = randomBytes(32).toString('hex');
      expect(createHash('sha256').update(raw, 'utf8').digest('hex')).toMatch(
        /^[a-f0-9]{64}$/,
      );
    });
  });

  describe('assertAccountantBuildingAccess', () => {
    it('allows switching when an AccountantAccess grant exists', async () => {
      prisma.accountantAccess.findUnique.mockResolvedValue({
        id: 'access-1',
        accountantId: 'user-1',
        buildingId: 'building-9',
        grantedById: 'admin-1',
        createdAt: new Date(),
      });

      await expect(
        service.assertAccountantBuildingAccess('user-1', 'building-9'),
      ).resolves.toBeUndefined();
      expect(prisma.accountantAccess.findUnique).toHaveBeenCalledWith({
        where: {
          accountantId_buildingId: {
            accountantId: 'user-1',
            buildingId: 'building-9',
          },
        },
        select: { id: true },
      });
    });

    it('rejects switching into a building without a grant', async () => {
      prisma.accountantAccess.findUnique.mockResolvedValue(null);

      await expect(
        service.assertAccountantBuildingAccess('user-1', 'building-x'),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('login', () => {
    const seededHash = bcrypt.hashSync('Passw0rd!', 10);
    const dto = { email: 'resident01@demo.gr', password: 'Passw0rd!' };

    it('returns access + refresh tokens on success', async () => {
      const user = makeUser({ passwordHash: seededHash });
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.login(dto);
      if (!('accessToken' in result)) throw new Error('expected tokens');
      const tokens = result;

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();

      const access = jwtService.verify<Record<string, unknown>>(
        tokens.accessToken,
        { secret: JWT_ACCESS_SECRET },
      );
      expect(access.sub).toBe('user-1');
      expect(access.type).toBe('access');
      expect(access.role).toBe(Role.RESIDENT);

      const refresh = jwtService.verify<Record<string, unknown>>(
        tokens.refreshToken,
        { secret: JWT_REFRESH_SECRET },
      );
      expect(refresh.type).toBe('refresh');
    });

    it('records a refresh session for the issued token (device meta)', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: seededHash }),
      );

      const result = await service.login(dto, {
        userAgent: 'TestBrowser',
        ip: '127.0.0.1',
      });
      if (!('accessToken' in result)) throw new Error('expected tokens');

      expect(sessions.record).toHaveBeenCalledWith(
        'user-1',
        result.refreshToken,
        { userAgent: 'TestBrowser', ip: '127.0.0.1' },
      );
    });

    it('still logs in when no SessionsService is wired (optional dep)', async () => {
      const bareService = new AuthService(
        prisma as unknown as PrismaService,
        jwtService,
        { verifyLoginCode } as unknown as TwoFactorService,
      );
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: seededHash }),
      );

      const result = await bareService.login(dto);
      expect(result.twoFactorRequired).toBeFalsy();
    });

    it('throws generic 401 for unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nobody@demo.gr', password: 'Passw0rd!' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.login({ email: 'nobody@demo.gr', password: 'Passw0rd!' }),
      ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    });

    it('throws generic 401 for wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: seededHash }),
      );
      await expect(
        service.login({ email: dto.email, password: 'WrongPass1' }),
      ).rejects.toMatchObject({ status: 401, message: 'Invalid credentials' });
    });
  });

  describe('login with twoFactorEnabled', () => {
    const seededHash = bcrypt.hashSync('Passw0rd!', 10);
    const dto = { email: 'resident01@demo.gr', password: 'Passw0rd!' };

    it('returns a challenge + ticket instead of tokens when 2FA is enabled', async () => {
      const user = makeTwoFactorUser();
      user.passwordHash = seededHash;
      prisma.user.findUnique.mockResolvedValue(user);

      const result = await service.login(dto);

      expect(result).toMatchObject({ twoFactorRequired: true });
      const challenge = result as TwoFactorChallenge;
      // The ticket is opaque — the userId must not leak in plaintext.
      expect(challenge.ticket).not.toContain(user.id);
      expect(verifyLoginTicket(challenge.ticket)).toBe('user-1');
      expect((challenge as unknown as Record<string, unknown>).accessToken).toBeUndefined();
    });

    it('issues tokens directly for users WITHOUT 2FA enabled', async () => {
      prisma.user.findUnique.mockResolvedValue(
        makeUser({
          passwordHash: seededHash,
        }) as User & { twoFactorEnabled?: boolean },
      );

      const result = await service.login(dto);

      expect(result.twoFactorRequired).toBeFalsy();
      expect(
        (result as { accessToken?: string }).accessToken,
      ).toBeDefined();
    });
  });

  describe('verifyTwoFactorLogin', () => {
    const dto = () => ({ ticket: signLoginTicket('user-1'), token: '123456' });

    it('redeems a valid ticket + code into a regular token pair', async () => {
      prisma.user.findUnique.mockResolvedValue(makeTwoFactorUser());

      const tokens = await service.verifyTwoFactorLogin(dto());

      expect(verifyLoginCode).toHaveBeenCalledWith(expect.anything(), '123456');
      const access = jwtService.verify<Record<string, unknown>>(
        tokens.accessToken,
        { secret: JWT_ACCESS_SECRET },
      );
      expect(access.sub).toBe('user-1');
      expect(access.type).toBe('access');
    });

    it('rejects a tampered ticket with 401 and never touches the DB', async () => {
      const tampered = `${signLoginTicket('user-1')}x`;

      await expect(
        service.verifyTwoFactorLogin({ ...dto(), ticket: tampered }),
      ).rejects.toMatchObject({ status: 401 });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an expired ticket with 401', async () => {
      const expired = signLoginTicket('user-1', Date.now() - 6 * 60 * 1000);

      await expect(
        service.verifyTwoFactorLogin({ ...dto(), ticket: expired }),
      ).rejects.toMatchObject({
        status: 401,
        message: 'Invalid or expired 2FA ticket',
      });
    });

    it('rejects garbage tickets with 401', async () => {
      await expect(
        service.verifyTwoFactorLogin({ ...dto(), ticket: 'garbage' }),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('rejects when the user no longer exists or has 2FA disabled', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeUser());

      await expect(service.verifyTwoFactorLogin(dto())).rejects.toMatchObject({
        status: 401,
      });
      await expect(service.verifyTwoFactorLogin(dto())).rejects.toMatchObject({
        status: 401,
        message: 'Invalid verification code',
      });
    });

    it('rejects a wrong second-factor code with 401', async () => {
      prisma.user.findUnique.mockResolvedValue(makeTwoFactorUser());
      verifyLoginCode.mockResolvedValue(false);

      await expect(
        service.verifyTwoFactorLogin({ ...dto(), token: '000000' }),
      ).rejects.toMatchObject({
        status: 401,
        message: 'Invalid verification code',
      });
    });
  });

  describe('refresh', () => {
    const userId = 'user-1';

    const signRefresh = () =>
      jwtService.sign(
        { sub: userId, type: 'refresh' },
        { secret: JWT_REFRESH_SECRET, expiresIn: '7d' },
      );

    it('accepts a valid refresh token and issues a new access token', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const tokens = await service.refresh(signRefresh());

      const access = jwtService.verify<Record<string, unknown>>(
        tokens.accessToken,
        { secret: JWT_ACCESS_SECRET },
      );
      expect(access.sub).toBe(userId);
      expect(access.type).toBe('access');
    });

    it('checks revocations and re-points the session onto the rotated token', async () => {
      const previous = signRefresh();
      prisma.user.findUnique.mockResolvedValue(makeUser());

      const tokens = await service.refresh(previous, {
        userAgent: 'TestBrowser',
      });

      expect(sessions.assertNotRevoked).toHaveBeenCalledWith(previous);
      expect(sessions.rotate).toHaveBeenCalledWith(
        userId,
        previous,
        tokens.refreshToken,
      );
    });

    it('throws 401 when the cookie token is missing', async () => {
      await expect(service.refresh(undefined)).rejects.toMatchObject({
        status: 401,
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws 401 when the cookie token is invalid/garbage', async () => {
      await expect(service.refresh('not-a-jwt')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('throws 401 when an access token is used as refresh token', async () => {
      const accessToken = jwtService.sign(
        {
          sub: userId,
          type: 'access',
          email: 'resident01@demo.gr',
          role: Role.RESIDENT,
          buildingId: null,
        },
        { secret: JWT_ACCESS_SECRET, expiresIn: '15m' },
      );
      await expect(service.refresh(accessToken)).rejects.toMatchObject({
        status: 401,
        message: 'Invalid refresh token',
      });
    });
  });

  // --- Referrals (additive): referralCode is accepted at signup but grants
  // happen at subscription activation (buildings do not exist yet).
  describe('register with referralCode', () => {
    it('completes a plain signup carrying a referral code', async () => {
      prisma.user.create.mockResolvedValue(
        makeUser({ id: 'user-9', email: 'ref@demo.gr' }),
      );

      const result = await service.register({
        email: 'ref@demo.gr',
        password: 'Passw0rd!',
        firstName: 'Maria',
        lastName: 'Ioannou',
        referralCode: 'BLD-ABC234',
      } as Parameters<AuthService['register']>[0]);

      expect(result).toEqual({
        id: 'user-9',
        email: 'ref@demo.gr',
        role: Role.RESIDENT,
      });
      // No reward side effects at registration time.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
