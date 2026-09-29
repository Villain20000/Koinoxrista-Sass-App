import './test-env';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, User } from '@prisma/client';

import {
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
} from './auth.types';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

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

describe('JwtStrategy / JwtAuthGuard', () => {
  const jwtService = new JwtService();
  let strategy: JwtStrategy;
  let guard: JwtAuthGuard;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { user: { findUnique: jest.fn() } };
    strategy = new JwtStrategy(
      jwtService,
      prisma as unknown as PrismaService,
    );
    guard = new JwtAuthGuard({ get: () => strategy } as never);
  });

  const signAccess = (overrides: Record<string, unknown> = {}) =>
    jwtService.sign(
      {
        sub: 'user-1',
        type: 'access',
        email: 'resident01@demo.gr',
        role: Role.RESIDENT,
        buildingId: 'building-1',
        ...overrides,
      },
      { secret: JWT_ACCESS_SECRET, expiresIn: '15m' },
    );

  it('validates a valid access token against the current DB row', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser());

    const user = await strategy.authenticate(`Bearer ${signAccess()}`);
    expect(user).toEqual({
      id: 'user-1',
      email: 'resident01@demo.gr',
      role: Role.RESIDENT,
      buildingId: 'building-1',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });

  it('prefers the DB active buildingId over stale token claims', async () => {
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ role: Role.ADMIN, buildingId: 'building-2' }),
    );

    const user = await strategy.authenticate(
      `Bearer ${signAccess({ role: Role.RESIDENT, buildingId: 'building-1' })}`,
    );
    expect(user).toEqual({
      id: 'user-1',
      email: 'resident01@demo.gr',
      role: Role.ADMIN,
      buildingId: 'building-2',
    });
  });

  it('rejects a refresh-type token presented as access token', async () => {
    const refreshToken = jwtService.sign(
      { sub: 'user-1', type: 'refresh' },
      { secret: JWT_REFRESH_SECRET, expiresIn: '7d' },
    );
    await expect(
      strategy.validate({ sub: 'user-1', type: 'refresh' } as never),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      strategy.authenticate(`Bearer ${refreshToken}`),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects expired tokens', async () => {
    const expired = jwtService.sign(
      { sub: 'user-1', type: 'access', email: 'e@d.gr', role: Role.ADMIN, buildingId: null },
      { secret: JWT_ACCESS_SECRET, expiresIn: '-1s' },
    );
    await expect(strategy.authenticate(`Bearer ${expired}`)).rejects.toMatchObject(
      { status: 401 },
    );
  });

  it('rejects tokens for unknown/deleted users', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.authenticate(`Bearer ${signAccess()}`)).rejects.toMatchObject(
      { status: 401, message: 'User not found' },
    );
  });

  it('guard attaches fresh user to request and allows through', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser());
    const request = { headers: { authorization: `Bearer ${signAccess()}` } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never as import('@nestjs/common').ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((request as { user?: unknown }).user).toMatchObject({
      id: 'user-1',
      role: Role.RESIDENT,
    });
  });

  it.each([
    ['missing header', undefined],
    ['non-bearer header', 'Basic abc'],
    ['garbage token', 'Bearer not-a-jwt'],
  ])('guard rejects with 401 for %s', async (_label, header) => {
    await expect(strategy.authenticate(header)).rejects.toMatchObject({
      status: 401,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
