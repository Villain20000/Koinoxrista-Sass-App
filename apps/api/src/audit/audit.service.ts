import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { AuditLog, Prisma, Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

/** One append-only audit entry. All fields except action/entity are optional. */
export interface AuditEntry {
  buildingId?: string | null;
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface AuditListFilters {
  action?: string;
  entity?: string;
  entityId?: string;
  fromISO?: string;
  toISO?: string;
  skip?: number;
  take?: number;
}

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly lastHashCache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  private hashFor(entry: AuditEntry, prevHash: string): string {
    const payload = [
      prevHash,
      entry.action,
      entry.entity,
      entry.entityId ?? '',
      entry.actorId ?? '',
      JSON.stringify(entry.metadata ?? {}),
    ].join('|');
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Fire-and-forget audit write with tamper-evident hash chaining.
   * Each entry stores `_hash` and `_prev` inside `metadata` so the chain can be
   * verified via `verifyChain`. The DB write remains async and never blocks callers.
   */
  record(entry: AuditEntry): void {
    const cacheKey = entry.buildingId ?? '__global__';
    const cachedPrev = this.lastHashCache.get(cacheKey);

    const write = async () => {
      let prevHash = cachedPrev ?? '';
      if (!cachedPrev) {
        try {
          const last = await this.prisma.auditLog.findFirst({
            where: { buildingId: entry.buildingId ?? null },
            orderBy: { createdAt: 'desc' },
            select: { metadata: true },
          });
          const meta = last?.metadata as Record<string, unknown> | null | undefined;
          if (meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>)._hash === 'string') {
            prevHash = (meta as Record<string, unknown>)._hash as string;
          } else if (last) {
            // Fallback: hash the last row id when no prior chain exists
            prevHash = (last as unknown as { id?: string }).id ?? '';
          }
        } catch {
          // ignore fetch errors — chain starts from empty
        }
      }

      const newHash = this.hashFor(entry, prevHash);
      this.lastHashCache.set(cacheKey, newHash);

      const chainedMetadata = {
        ...(entry.metadata ?? {}),
        _hash: newHash,
        _prev: prevHash || null,
        _chain: 1,
      } as Prisma.InputJsonValue;

      const { metadata: _ignored, ...rest } = entry;
      await this.prisma.auditLog.create({
        data: {
          ...rest,
          metadata: chainedMetadata,
        },
      });
    };

    void write().catch((error: unknown) => {
      // Keep console.warn for test compatibility and Logger for prod visibility
      console.warn(`[audit] write failed for ${entry.action}:`, error);
      this.logger.warn(`[audit] write failed for ${entry.action}: ${String(error)}`);
    });
  }

  /**
   * Verifies the hash chain for a building. Returns the first break if any.
   */
  async verifyChain(
    buildingId: string | null,
    limit = 200,
  ): Promise<{ valid: boolean; checked: number; firstBreakAt?: string }> {
    const rows = await this.prisma.auditLog.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let prev = '';
    for (const row of rows) {
      const meta = row.metadata as Record<string, unknown> | null;
      const storedHash = meta && typeof meta._hash === 'string' ? (meta._hash as string) : null;
      const storedPrev = meta && typeof meta._prev === 'string' ? (meta._prev as string) : meta?._prev === null ? '' : null;
      // Reconstruct entry for hashing (exclude chain fields)
      const entryMeta = meta ? { ...meta } : {};
      delete (entryMeta as Record<string, unknown>)._hash;
      delete (entryMeta as Record<string, unknown>)._prev;
      delete (entryMeta as Record<string, unknown>)._chain;
      const cleanMeta = Object.keys(entryMeta).length ? entryMeta : null;
      const entry: AuditEntry = {
        buildingId: row.buildingId,
        actorId: row.actorId,
        actorRole: row.actorRole,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        metadata: cleanMeta as Record<string, unknown> | null,
        ip: row.ip,
      };
      const expectedPrev = storedPrev ?? prev;
      // If row has no chain (pre-upgrade rows), skip verification for that row
      if (storedHash === null) {
        prev = '';
        continue;
      }
      const expectedHash = this.hashFor(entry, expectedPrev);
      if (expectedHash !== storedHash || expectedPrev !== prev) {
        return { valid: false, checked: rows.indexOf(row), firstBreakAt: row.id };
      }
      prev = storedHash;
    }
    return { valid: true, checked: rows.length };
  }

  async list(
    filters: AuditListFilters,
    user: Pick<AuthenticatedUser, 'buildingId'>,
  ): Promise<{ items: AuditLog[]; total: number }> {
    if (!user.buildingId) {
      return { items: [], total: 0 };
    }

    const take = Math.min(Math.max(filters.take ?? DEFAULT_TAKE, 1), MAX_TAKE);
    const skip = filters.skip ?? 0;

    const where: Prisma.AuditLogWhereInput = {
      buildingId: user.buildingId,
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entity ? { entity: filters.entity } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.fromISO || filters.toISO
        ? {
            createdAt: {
              ...(filters.fromISO ? { gte: new Date(filters.fromISO) } : {}),
              ...(filters.toISO ? { lte: new Date(filters.toISO) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total };
  }
}
