import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SessionsService,
  hashRefreshToken,
} from './sessions.service';

function makePrisma() {
  return {
    refreshSession: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      update: jest.fn().mockResolvedValue({ id: 'session-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

function makeAudit() {
  return { record: jest.fn() };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('hashRefreshToken', () => {
  it('is stable and hex-encoded', () => {
    expect(hashRefreshToken('token-a')).toBe(hashRefreshToken('token-a'));
    expect(hashRefreshToken('token-a')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'));
  });
});

describe('SessionsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: SessionsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new SessionsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('record', () => {
    it('stores the sha256 of the raw token with device meta', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue(null);

      service.record('user-1', 'raw-jwt', {
        userAgent: 'Mozilla/5.0',
        ip: '10.0.0.1',
      });
      await flush();

      expect(prisma.refreshSession.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          tokenHash: hashRefreshToken('raw-jwt'),
          userAgent: 'Mozilla/5.0',
          ip: '10.0.0.1',
        },
      });
    });

    it('is idempotent for an already-tracked token', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue({ id: 'existing' });

      service.record('user-1', 'raw-jwt');
      await flush();

      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
    });

    it('swallows storage failures (auth must not break)', async () => {
      prisma.refreshSession.findFirst.mockRejectedValue(new Error('db down'));

      service.record('user-1', 'raw-jwt');
      await flush();

      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    it('re-points the previous session row onto the rotated token', async () => {
      prisma.refreshSession.updateMany.mockResolvedValue({ count: 1 });

      service.rotate('user-1', 'old-jwt', 'new-jwt');
      await flush();

      expect(prisma.refreshSession.deleteMany).toHaveBeenCalledWith({
        where: { tokenHash: hashRefreshToken('new-jwt') },
      });
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', tokenHash: hashRefreshToken('old-jwt') },
        data: {
          tokenHash: hashRefreshToken('new-jwt'),
          lastUsedAt: expect.any(Date),
        },
      });
      expect(prisma.refreshSession.create).not.toHaveBeenCalled();
    });

    it('starts tracking fresh when no predecessor exists', async () => {
      prisma.refreshSession.updateMany.mockResolvedValue({ count: 0 });

      service.rotate('user-1', 'old-jwt', 'new-jwt');
      await flush();

      expect(prisma.refreshSession.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', tokenHash: hashRefreshToken('new-jwt') },
      });
    });
  });

  describe('assertNotRevoked', () => {
    it('rejects refreshes of a revoked session', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue({
        revokedAt: new Date(),
      });

      await expect(service.assertNotRevoked('revoked-jwt')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('allows untracked tokens (fail-open) and active sessions', async () => {
      prisma.refreshSession.findFirst.mockResolvedValueOnce(null);
      await expect(service.assertNotRevoked('legacy-jwt')).resolves.toBeUndefined();

      prisma.refreshSession.findFirst.mockResolvedValueOnce({ revokedAt: null });
      await expect(service.assertNotRevoked('live-jwt')).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('returns non-revoked sessions newest first and flags the current one', async () => {
      const now = new Date('2026-08-25T10:00:00Z');
      prisma.refreshSession.findMany.mockResolvedValue([
        {
          id: 's-new',
          createdAt: now,
          lastUsedAt: now,
          userAgent: 'Chrome',
          ip: null,
          tokenHash: hashRefreshToken('current-jwt'),
        },
        {
          id: 's-old',
          createdAt: new Date('2026-08-20T10:00:00Z'),
          lastUsedAt: now,
          userAgent: null,
          ip: '1.2.3.4',
          tokenHash: hashRefreshToken('other-jwt'),
        },
      ]);

      const result = await service.list(
        'user-1',
        hashRefreshToken('current-jwt'),
      );

      expect(prisma.refreshSession.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 's-new', isCurrent: true });
      expect(result[1]).toMatchObject({ id: 's-old', isCurrent: false });
    });

    it('marks nothing current without a reference hash', async () => {
      prisma.refreshSession.findMany.mockResolvedValue([
        {
          id: 's-new',
          createdAt: new Date(),
          lastUsedAt: new Date(),
          userAgent: null,
          ip: null,
          tokenHash: 'x',
        },
      ]);

      const result = await service.list('user-1');
      expect(result[0].isCurrent).toBe(false);
    });
  });

  describe('revoke', () => {
    const session = {
      id: 's-1',
      userId: 'user-1',
      tokenHash: hashRefreshToken('other-jwt'),
      revokedAt: null,
    };

    it('sets revokedAt on an owned session and audits', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue(session);

      await service.revoke('user-1', 's-1', hashRefreshToken('current-jwt'));

      expect(prisma.refreshSession.update).toHaveBeenCalledWith({
        where: { id: 's-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'user-1',
          action: 'session.revoke',
          entityId: 's-1',
        }),
      );
    });

    it('blocks self-revocation of the current session', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue(session);

      await expect(
        service.revoke('user-1', 's-1', session.tokenHash),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.refreshSession.update).not.toHaveBeenCalled();
    });

    it('404s missing or foreign sessions (tenancy)', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue(null);
      await expect(service.revoke('user-1', 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s an already-revoked session (idempotent UI)', async () => {
      prisma.refreshSession.findFirst.mockResolvedValue({
        ...session,
        revokedAt: new Date(),
      });
      await expect(service.revoke('user-1', 's-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revokeOthers', () => {
    it('revokes every active session except the current hash', async () => {
      prisma.refreshSession.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.revokeOthers(
        'user-1',
        hashRefreshToken('current-jwt'),
      );

      expect(result).toEqual({ revoked: 2 });
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          revokedAt: null,
          tokenHash: { not: hashRefreshToken('current-jwt') },
        },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalled();
    });

    it('requires an identifiable current session', async () => {
      await expect(service.revokeOthers('user-1', undefined)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
    });
  });
});
