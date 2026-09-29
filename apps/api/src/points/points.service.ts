import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';

export type PointReason =
  | 'ONTIME_PAYMENT'
  | 'ATTENDANCE'
  | 'MANUAL_ADJ'
  | 'REDEEM';

export interface PointBalanceView {
  userId: string;
  buildingId: string;
  balance: number;
}

export interface PointLedgerRow {
  id: string;
  userId: string;
  delta: number;
  reason: PointReason;
  refType: string | null;
  refId: string | null;
  balanceAfter: number;
  createdAt: string;
}

export const POINTS_ONTIME = 50;
export const POINTS_ATTENDANCE = 10;

@Injectable()
export class PointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Resident-facing balance + recent ledger. */
  async mine(user: AuthenticatedUser): Promise<{
    balance: number;
    history: PointLedgerRow[];
  }> {
    if (!user.buildingId) {
      throw new ForbiddenException('User is not linked to a building');
    }
    const userRow = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { pointBalance: true },
    });
    const history = await this.prisma.pointTransaction.findMany({
      where: { userId: user.id, buildingId: user.buildingId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      balance: userRow?.pointBalance ?? 0,
      history: history.map((row) => this.toLedgerRow(row)),
    };
  }

  /**
   * Earn points, once per (userId, reason, refId) — the unique constraint in
   * the schema makes retries idempotent. Balance is materialized on User and
   * updated in the same transaction as the ledger row.
   */
  async earn(input: {
    userId: string;
    buildingId: string;
    delta: number;
    reason: PointReason;
    refType?: string;
    refId?: string;
  }): Promise<PointBalanceView> {
    if (input.delta <= 0) throw new BadRequestException('delta must be positive to earn');

    // Idempotency: same (userId, reason, refId) only earns once. Null refId
    // cannot use the compound-unique where, so use a plain findFirst.
    const existing = await this.prisma.pointTransaction.findFirst({
      where: {
        userId: input.userId,
        reason: input.reason,
        refId: input.refId ?? null,
      },
      select: { id: true },
    });
    if (existing) return this.balanceOf(input.userId, input.buildingId);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user) throw new NotFoundException('User not found');
      const balanceAfter = user.pointBalance + input.delta;
      await tx.user.update({
        where: { id: input.userId },
        data: { pointBalance: balanceAfter },
      });
      await tx.pointTransaction.create({
        data: {
          userId: input.userId,
          buildingId: input.buildingId,
          delta: input.delta,
          reason: input.reason,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          balanceAfter,
        },
      });
      return { userId: input.userId, buildingId: input.buildingId, balance: balanceAfter };
    });
  }

  /** Admin manual adjustment (audited) — may be positive or negative. */
  async adjust(
    buildingId: string,
    userId: string,
    delta: number,
    user: AuthenticatedUser,
    note?: string,
  ): Promise<PointBalanceView> {
    assertSameBuilding(user, buildingId);
    if (delta === 0) throw new BadRequestException('delta must be non-zero');

    const result = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({ where: { id: userId, buildingId } });
      if (!target) throw new NotFoundException('User not found in building');
      const balanceAfter = target.pointBalance + delta;
      if (balanceAfter < 0) {
        throw new BadRequestException('Adjustment would make the balance negative');
      }
      await tx.user.update({ where: { id: userId }, data: { pointBalance: balanceAfter } });
      return tx.pointTransaction.create({
        data: {
          userId,
          buildingId,
          delta,
          reason: 'MANUAL_ADJ',
          refType: 'adjustment',
          refId: note ?? null,
          balanceAfter,
        },
      });
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'points.adjust',
      entity: 'point_transaction',
      entityId: result.id,
      metadata: { userId, delta, note: note ?? null },
    });
    return { userId, buildingId, balance: result.balanceAfter };
  }

  /** Redeem points toward an on-account discount (flagged for invoice run). */
  async redeem(
    buildingId: string,
    userId: string,
    points: number,
    user: AuthenticatedUser,
  ): Promise<{ redeemed: number; balance: number }> {
    assertSameBuilding(user, buildingId);
    if (!Number.isInteger(points) || points <= 0) {
      throw new BadRequestException('points must be a positive integer');
    }
    const target = await this.prisma.user.findFirst({ where: { id: userId, buildingId } });
    if (!target) throw new NotFoundException('User not found in building');
    if (target.pointBalance < points) {
      throw new BadRequestException('Insufficient points balance');
    }
    const balanceAfter = target.pointBalance - points;
    await this.prisma.user.update({ where: { id: userId }, data: { pointBalance: balanceAfter } });
    await this.prisma.pointTransaction.create({
      data: {
        userId,
        buildingId,
        delta: -points,
        reason: 'REDEEM',
        refType: 'discount',
        refId: null,
        balanceAfter,
      },
    });
    return { redeemed: points, balance: balanceAfter };
  }

  private async balanceOf(userId: string, buildingId: string): Promise<PointBalanceView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pointBalance: true },
    });
    return { userId, buildingId, balance: user?.pointBalance ?? 0 };
  }

  private toLedgerRow(row: {
    id: string;
    userId: string;
    delta: number;
    reason: string;
    refType: string | null;
    refId: string | null;
    balanceAfter: number;
    createdAt: Date;
  }): PointLedgerRow {
    return {
      id: row.id,
      userId: row.userId,
      delta: row.delta,
      reason: row.reason as PointReason,
      refType: row.refType,
      refId: row.refId,
      balanceAfter: row.balanceAfter,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export function isPrismaP2002(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  );
}