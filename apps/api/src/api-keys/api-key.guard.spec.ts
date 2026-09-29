import {
  ExecutionContext,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ApiKeyRateLimiter } from './api-key-rate-limiter';
import { API_KEY_SCOPE_KEY } from './decorators/current-api-key.decorator';

const RAW_KEY = 'pk_abcd1234_' + 'A'.repeat(43);

function makeKey(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    buildingId: 'building-1',
    userId: 'user-1',
    name: 'CI key',
    prefix: 'abcd1234',
    keyHash: 'hash',
    scopes: ['invoices:read', 'payments:read', 'votes:read'],
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    building: {
      id: 'building-1',
      subscription: { tier: 'PREMIUM', status: 'ACTIVE' },
    },
    ...overrides,
  };
}

interface Harness {
  guard: ApiKeyGuard;
  context: ExecutionContext;
  prisma: { apiKey: { findUnique: jest.Mock; update: jest.Mock } };
  response: { setHeader: jest.Mock };
}

function makeHarness(
  key: Record<string, unknown> | null = makeKey(),
  scope: string | undefined = 'invoices:read',
  headers: Record<string, string> = { 'x-api-key': RAW_KEY },
): Harness {
  const prisma = {
    apiKey: {
      findUnique: jest.fn().mockResolvedValue(key),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(scope) };
  const request = { headers };
  const response = { setHeader: jest.fn() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => () => undefined,
    getClass: () =>
      class {
        static readonly API_KEY_SCOPE_KEY = API_KEY_SCOPE_KEY;
      },
  } as unknown as ExecutionContext;

  const guard = new ApiKeyGuard(
    prisma as unknown as PrismaService,
    reflector as unknown as Reflector,
    new ApiKeyRateLimiter(60, 60_000),
  );
  return { guard, context, prisma, response };
}

describe('ApiKeyGuard', () => {
  it('rejects a missing X-Api-Key header with 401', async () => {
    const { guard, context, prisma } = makeHarness(makeKey(), 'invoices:read', {});

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an unknown key with 401', async () => {
    const { guard, context, prisma } = makeHarness(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
      where: { keyHash: expect.any(String) },
      include: { building: { include: { subscription: true } } },
    });
  });

  it('rejects a revoked key with 401', async () => {
    const { guard, context } = makeHarness(
      makeKey({ revokedAt: new Date('2026-02-01T00:00:00.000Z') }),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a valid key lacking the route scope with 403', async () => {
    const { guard, context } = makeHarness(
      makeKey({ scopes: ['votes:read'] }),
      'invoices:read',
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it.each([
    ['ACTIVE PREMIUM', { tier: 'PREMIUM', status: 'ACTIVE' }, true],
    ['TRIALING PREMIUM', { tier: 'PREMIUM', status: 'TRIALING' }, true],
    ['no subscription at all', null, false],
    ['BASIC tier', { tier: 'BASIC', status: 'ACTIVE' }, false],
    ['PRO tier', { tier: 'PRO', status: 'ACTIVE' }, false],
    ['PAST_DUE status', { tier: 'PREMIUM', status: 'PAST_DUE' }, false],
    ['CANCELLED status', { tier: 'PREMIUM', status: 'CANCELLED' }, false],
  ])(
    'enforces PREMIUM + ACTIVE/TRIALING (%s)',
    async (_label, subscription, allowed) => {
      const key = makeKey();
      (key.building as { subscription: unknown }).subscription = subscription;
      const { guard, context } = makeHarness(key);

      if (allowed) {
        await expect(guard.canActivate(context)).resolves.toBe(true);
      } else {
        await expect(guard.canActivate(context)).rejects.toThrow(
          ForbiddenException,
        );
        await expect(guard.canActivate(context)).rejects.toThrow(
          'Premium subscription required',
        );
      }
    },
  );

  it('returns 429 with Retry-After once the sliding window is exhausted', async () => {
    const { guard, context, response } = makeHarness();

    for (let i = 0; i < 60; i += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    let caught: unknown;
    try {
      await guard.canActivate(context);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(429);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Retry-After',
      expect.stringMatching(/^[1-9]\d*$/),
    );
  });

  it('attaches the principal to the request and touches lastUsedAt', async () => {
    const harness = makeHarness();
    const request = (
      harness.context.switchToHttp() as ReturnType<
        ExecutionContext['switchToHttp']
      >
    ).getRequest() as Record<string, unknown>;

    await expect(harness.guard.canActivate(harness.context)).resolves.toBe(true);
    expect(request['apiKey']).toMatchObject({
      id: 'key-1',
      buildingId: 'building-1',
    });
    expect(harness.prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
