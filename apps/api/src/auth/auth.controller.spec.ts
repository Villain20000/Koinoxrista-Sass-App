import './test-env';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  REFRESH_COOKIE_NAME,
  HttpRequest,
  HttpResponse,
} from './auth.types';
import type { AuthenticatedUser } from './auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipsService } from '../memberships/memberships.service';
import { TwoFactorService } from '../two-factor/two-factor.service';

const fakeRes = (): HttpResponse => {
  const res: Record<string, unknown> = {};
  res.cookie = jest.fn().mockReturnThis();
  return res as unknown as HttpResponse;
};

const fakeReq = (cookie?: string): HttpRequest =>
  ({
    headers: cookie ? { cookie } : {},
  }) as HttpRequest;

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    register: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    verifyTwoFactorLogin: jest.Mock;
  };
  let memberships: {
    listForUser: jest.Mock;
    requireMembership: jest.Mock;
    activateBuilding: jest.Mock;
  };
  let twoFactorService: {
    setup: jest.Mock;
    enable: jest.Mock;
    disable: jest.Mock;
    isEnabled: jest.Mock;
  };
  const jwtService = new JwtService();

  beforeEach(() => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      verifyTwoFactorLogin: jest.fn(),
    };
    memberships = {
      listForUser: jest.fn().mockResolvedValue([]),
      requireMembership: jest.fn(),
      activateBuilding: jest.fn(),
    };
    twoFactorService = {
      setup: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      isEnabled: jest.fn().mockResolvedValue(false),
    };
    controller = new AuthController(
      authService as unknown as AuthService,
      memberships as unknown as MembershipsService,
      twoFactorService as unknown as TwoFactorService,
    );
  });

  describe('register', () => {
    it('returns the created user summary', async () => {
      const summary = { id: 'u1', email: 'a@demo.gr', role: Role.RESIDENT };
      authService.register.mockResolvedValue(summary);

      const result = await controller.register({
        email: 'a@demo.gr',
        password: 'Passw0rd!',
        firstName: 'A',
        lastName: 'B',
      });

      expect(result).toEqual(summary);
    });
  });

  describe('login', () => {
    it('returns accessToken and sets HttpOnly SameSite=lax refresh cookie', async () => {
      const refreshToken = jwtService.sign(
        { sub: 'user-1', type: 'refresh' },
        { secret: JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      authService.login.mockResolvedValue({
        accessToken: 'access-token-xyz',
        refreshToken,
      });
      const res = fakeRes();

      const body = await controller.login(
        { email: 'resident01@demo.gr', password: 'Passw0rd!' },
        fakeReq(),
        res,
      );

      expect(body).toEqual({ accessToken: 'access-token-xyz' });
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        refreshToken,
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
      );
      const options = (res.cookie as jest.Mock).mock.calls[0][2];
      expect(options.maxAge).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    });

    it('returns the 2FA challenge without tokens or cookie when required', async () => {
      authService.login.mockResolvedValue({
        twoFactorRequired: true,
        ticket: 'ticket-abc',
      });
      const res = fakeRes();

      const body = await controller.login(
        { email: 'admin@demo.gr', password: 'Admin1234!' },
        fakeReq(),
        res,
      );

      expect(body).toEqual({ twoFactorRequired: true, ticket: 'ticket-abc' });
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('login/2fa', () => {
    it('redeems the ticket into an accessToken + refresh cookie', async () => {
      const refreshToken = jwtService.sign(
        { sub: 'user-1', type: 'refresh' },
        { secret: JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      authService.verifyTwoFactorLogin.mockResolvedValue({
        accessToken: 'access-after-2fa',
        refreshToken,
      });
      const res = fakeRes();

      const body = await controller.login2fa(
        { ticket: 'ticket-abc', token: '123456' },
        res,
      );

      expect(authService.verifyTwoFactorLogin).toHaveBeenCalledWith({
        ticket: 'ticket-abc',
        token: '123456',
      });
      expect(body).toEqual({ accessToken: 'access-after-2fa' });
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        refreshToken,
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('propagates 401 for invalid codes', async () => {
      authService.verifyTwoFactorLogin.mockRejectedValue(
        new UnauthorizedException('Invalid verification code'),
      );

      await expect(
        controller.login2fa(
          { ticket: 'ticket-abc', token: '000000' },
          fakeRes(),
        ),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('2fa setup/enable/disable', () => {
    const user: AuthenticatedUser = {
      id: 'user-1',
      email: 'admin@demo.gr',
      role: Role.ADMIN,
      buildingId: null,
    };

    it('setup returns secret + otpauthUri from TwoFactorService', () => {
      const payload = { secret: 'SECRET234', otpauthUri: 'otpauth://totp/x' };
      twoFactorService.setup.mockReturnValue(payload);

      expect(controller.setup2fa(user)).toEqual(payload);
      expect(twoFactorService.setup).toHaveBeenCalledWith('admin@demo.gr');
    });

    it('enable returns the recovery codes exactly once', async () => {
      twoFactorService.enable.mockResolvedValue(['AAAAA-BBBBB']);

      await expect(
        controller.enable2fa(user, {
          secret: 'SECRET234',
          token: '123456',
        }),
      ).resolves.toEqual({ enabled: true, recoveryCodes: ['AAAAA-BBBBB'] });
    });

    it('disable requires the password and reports the disabled state', async () => {
      await expect(
        controller.disable2fa(user, { password: 'Admin1234!' }),
      ).resolves.toEqual({ twoFactorEnabled: false });
      expect(twoFactorService.disable).toHaveBeenCalledWith(
        'user-1',
        'Admin1234!',
      );
    });
  });

  describe('refresh', () => {
    it('reads the refresh_token cookie and returns a new accessToken with a rotated cookie', async () => {
      const oldRefresh = jwtService.sign(
        { sub: 'user-1', type: 'refresh' },
        { secret: JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      const newRefresh = jwtService.sign(
        { sub: 'user-1', type: 'refresh' },
        { secret: JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      authService.refresh.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: newRefresh,
      });
      const res = fakeRes();

      const body = await controller.refresh(
        fakeReq(`${REFRESH_COOKIE_NAME}=${oldRefresh}`),
        res,
      );

      expect(authService.refresh).toHaveBeenCalledWith(oldRefresh, {
        ip: null,
        userAgent: null,
      });
      expect(body).toEqual({ accessToken: 'new-access-token' });
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        newRefresh,
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('propagates 401 when no cookie is present', async () => {
      authService.refresh.mockRejectedValue(
        new UnauthorizedException('Missing refresh token'),
      );
      const res = fakeRes();

      await expect(controller.refresh(fakeReq(), res)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('propagates 401 when the cookie value is invalid', async () => {
      authService.refresh.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );
      const res = fakeRes();

      await expect(
        controller.refresh(fakeReq(`${REFRESH_COOKIE_NAME}=garbage`), res),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('me', () => {
    it('returns id/email/role/buildingId plus the memberships list', async () => {
      const user: AuthenticatedUser = {
        id: 'user-1',
        email: 'resident01@demo.gr',
        role: Role.RESIDENT,
        buildingId: 'building-1',
      };
      const membershipList = [
        {
          id: 'm1',
          role: Role.RESIDENT,
          isDefault: true,
          building: {
            id: 'building-1',
            name: 'A Building',
            address: 'Odos 1',
            city: 'Thessaloniki',
          },
        },
      ];
      memberships.listForUser.mockResolvedValue(membershipList);

      await expect(controller.me(user)).resolves.toEqual({
        id: 'user-1',
        email: 'resident01@demo.gr',
        role: Role.RESIDENT,
        buildingId: 'building-1',
        market: 'GR',
        currency: 'EUR',
        twoFactorEnabled: false,
        memberships: membershipList,
      });
      expect(memberships.listForUser).toHaveBeenCalledWith('user-1');
    });

    it('reports twoFactorEnabled=true when the user has 2FA on', async () => {
      const user: AuthenticatedUser = {
        id: 'user-2',
        email: 'admin@demo.gr',
        role: Role.ADMIN,
        buildingId: null,
      };
      twoFactorService.isEnabled.mockResolvedValue(true);

      await expect(controller.me(user)).resolves.toMatchObject({
        id: 'user-2',
        twoFactorEnabled: true,
      });
    });
  });

  describe('buildings', () => {
    it('returns the signed-in user memberships list', async () => {
      const user: AuthenticatedUser = {
        id: 'user-1',
        email: 'admin@demo.gr',
        role: Role.ADMIN,
        buildingId: 'building-2',
      };
      memberships.listForUser.mockResolvedValue([
        { id: 'm1', role: Role.ADMIN, isDefault: true, building: { id: 'building-1', name: 'A', address: 'X', city: 'Y' } },
      ]);

      await expect(controller.buildings(user)).resolves.toHaveLength(1);
      expect(memberships.listForUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('switch-building', () => {
    const admin: AuthenticatedUser = {
      id: 'user-1',
      email: 'admin@demo.gr',
      role: Role.ADMIN,
      buildingId: 'building-1',
    };

    it('propagates 403 when the user is not a member of the target building', async () => {
      memberships.requireMembership.mockRejectedValue(
        new ForbiddenException('Not a member of this building'),
      );
      const res = fakeRes();

      await expect(
        controller.switchBuilding(admin, { buildingId: 'building-x' }, res),
      ).rejects.toMatchObject({
        status: 403,
        message: 'Not a member of this building',
      });
      expect(memberships.activateBuilding).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('issues a new token carrying the new active buildingId and rotates the refresh cookie', async () => {
      // Real AuthService + real JwtService (auth.service.spec mock style) so
      // the issued token payload can be decoded and asserted.
      const realAuthService = new AuthService(
        {} as unknown as PrismaService,
        jwtService,
        {
          verifyLoginCode: jest.fn(),
        } as unknown as TwoFactorService,
      );
      const realController = new AuthController(
        realAuthService,
        memberships as unknown as MembershipsService,
        twoFactorService as unknown as TwoFactorService,
      );
      memberships.requireMembership.mockResolvedValue({
        id: 'm2',
        userId: 'user-1',
        buildingId: 'building-2',
        role: Role.ADMIN,
        isDefault: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      memberships.activateBuilding.mockResolvedValue({
        id: 'user-1',
        email: 'admin@demo.gr',
        passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
        firstName: 'Nikos',
        lastName: 'Papadopoulos',
        phone: null,
        role: Role.ADMIN,
        buildingId: 'building-2',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      const res = fakeRes();

      const body = await realController.switchBuilding(
        admin,
        { buildingId: 'building-2' },
        res,
      );

      const access = jwtService.verify<Record<string, unknown>>(
        body.accessToken,
        { secret: JWT_ACCESS_SECRET },
      );
      expect(access.sub).toBe('user-1');
      expect(access.type).toBe('access');
      expect(access.role).toBe(Role.ADMIN);
      expect(access.buildingId).toBe('building-2');
      expect(memberships.activateBuilding).toHaveBeenCalledWith(
        'user-1',
        'building-2',
      );
      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.any(String),
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
      );
    });
  });
});
