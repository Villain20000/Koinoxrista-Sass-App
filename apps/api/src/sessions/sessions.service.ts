import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/** Request-scoped device info attached to a session on creation. */
export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

/** Client-facing shape of an active (non-revoked) refresh session. */
export interface SessionView {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  userAgent: string | null;
  ip: string | null;
  /** True when the row belongs to the token the request itself presented. */
  isCurrent: boolean;
}

/** sha256 hex of the full refresh-token string — the only stored form. */
export function hashRefreshToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Tracks a freshly issued refresh token. Fire-and-forget: auth must never
   * fail because session bookkeeping did. Idempotent per token hash so
   * duplicate issue paths cannot inflate the list.
   */
  record(userId: string, rawToken: string, meta?: SessionMeta): void {
    const tokenHash = hashRefreshToken(rawToken);
    this.prisma.refreshSession
      .findFirst({ where: { tokenHash }, select: { id: true } })
      .then((existing) => {
        if (existing) return null;
        return this.prisma.refreshSession.create({
          data: {
            userId,
            tokenHash,
            userAgent: meta?.userAgent ?? null,
            ip: meta?.ip ?? null,
          },
        });
      })
      .catch((error: unknown) =>
        this.logger.warn(`session record failed: ${String(error)}`),
      );
  }

  /**
   * Re-points the session row of a rotated refresh token onto its replacement
   * so one logical login stays one row. Falls back to tracking the new token
   * when the previous one predates this feature.
   */
  rotate(
    userId: string,
    previousRawToken: string,
    nextRawToken: string,
  ): void {
    const previousHash = hashRefreshToken(previousRawToken);
    const nextHash = hashRefreshToken(nextRawToken);
    if (previousHash === nextHash) return;
    this.prisma.refreshSession
      .deleteMany({ where: { tokenHash: nextHash } })
      .then(() =>
        this.prisma.refreshSession.updateMany({
          where: { tokenHash: previousHash, userId },
          data: { tokenHash: nextHash, lastUsedAt: new Date() },
        }),
      )
      .then((res) => {
        if (res.count === 0) {
          // No tracked predecessor — start tracking from this rotation.
          return this.prisma.refreshSession.create({
            data: { userId, tokenHash: nextHash },
          });
        }
        return null;
      })
      .catch((error: unknown) =>
        this.logger.warn(`session rotate failed: ${String(error)}`),
      );
  }

  /**
   * Fails the refresh flow for tokens whose session was revoked by the user.
   * Untracked tokens (pre-feature or legacy) stay valid — fail-open.
   */
  async assertNotRevoked(rawToken: string): Promise<void> {
    const session = await this.prisma.refreshSession.findFirst({
      where: { tokenHash: hashRefreshToken(rawToken) },
      select: { revokedAt: true },
    });
    if (session?.revokedAt) {
      throw new UnauthorizedException('Session revoked');
    }
  }

  /** Active sessions of one user, newest first, flagged against currentHash. */
  async list(userId: string, currentHash?: string): Promise<SessionView[]> {
    const rows = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      userAgent: row.userAgent,
      ip: row.ip,
      isCurrent: currentHash !== undefined && row.tokenHash === currentHash,
    }));
  }

  /** Owner-scoped revocation; the current session must be logged out instead. */
  async revoke(
    userId: string,
    sessionId: string,
    currentHash?: string,
  ): Promise<void> {
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session || session.revokedAt) {
      throw new NotFoundException('Session not found');
    }
    if (currentHash !== undefined && session.tokenHash === currentHash) {
      throw new BadRequestException(
        'Δεν μπορείτε να ανακαλέσετε την τρέχουσα συνεδρία — αποσυνδεθείτε αντ’ αυτού.',
      );
    }
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    this.audit.record({
      actorId: userId,
      action: 'session.revoke',
      entity: 'RefreshSession',
      entityId: session.id,
    });
  }

  /** Revokes every active session except the caller's own. */
  async revokeOthers(
    userId: string,
    currentHash: string | undefined,
  ): Promise<{ revoked: number }> {
    if (!currentHash) {
      throw new BadRequestException('Current session could not be identified');
    }
    const res = await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null, tokenHash: { not: currentHash } },
      data: { revokedAt: new Date() },
    });
    if (res.count > 0) {
      this.audit.record({
        actorId: userId,
        action: 'session.revokeOthers',
        entity: 'RefreshSession',
        metadata: { revoked: res.count },
      });
    }
    return { revoked: res.count };
  }

}
