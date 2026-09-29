import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { splitByLargestRemainder } from '../prisma/split-by-largest-remainder';
import { AllocationStrategy } from '@prisma/client';

import { resolveAllocationWeights } from '../expenses/allocation-weights';
import { ContributionDto } from './dto/contribution.dto';
import { CreateLevyDto } from './dto/create-levy.dto';
import { DrawdownDto } from './dto/drawdown.dto';

const LEVY_STATUSES = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  CLOSED: 'CLOSED',
} as const;

const ALLOWED_STRATEGIES = [
  'MILIMES',
  'UNITS',
  'CUSTOM',
  'SQUARE_METERS',
  'SHARE_FRACTION',
] as const;

@Injectable()
export class ReserveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Fund
  // -------------------------------------------------------------------------

  async getOrCreateFund(buildingId: string, user?: AuthenticatedUser) {
    if (user) assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as unknown as Record<string, any>;

    let fund = await prismaAny.reserveFund.findUnique({
      where: { buildingId },
    });
    if (fund) return fund;

    // Create with defaults; handle race where unique constraint fires
    try {
      fund = await prismaAny.reserveFund.create({
        data: { buildingId, targetCents: 0, balanceCents: 0 },
      });
      return fund;
    } catch (error) {
      // If unique violation (another request created), fetch again
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        fund = await prismaAny.reserveFund.findUnique({
          where: { buildingId },
        });
        if (fund) return fund;
      }
      throw error;
    }
  }

  async updateTarget(
    buildingId: string,
    targetCents: number,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!Number.isInteger(targetCents) || targetCents < 0) {
      throw new BadRequestException('targetCents must be a non-negative integer');
    }
    const prismaAny = this.prisma as unknown as Record<string, any>;
    const fund = await this.getOrCreateFund(buildingId, user);

    const updated = await prismaAny.reserveFund.update({
      where: { id: fund.id },
      data: { targetCents },
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'reserve.fund.target_updated',
      entity: 'reserve_fund',
      entityId: updated.id,
      metadata: { targetCents },
    });

    return updated;
  }

  async contribute(
    buildingId: string,
    dto: ContributionDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!Number.isInteger(dto.amountCents) || dto.amountCents <= 0) {
      throw new BadRequestException('amountCents must be a positive integer');
    }
    const prismaAny = this.prisma as unknown as Record<string, any>;
    const fund = await this.getOrCreateFund(buildingId, user);

    const result = await (this.prisma as any).$transaction(
      async (tx: Record<string, any>) => {
        const contribution = await tx.reserveContribution.create({
          data: {
            fundId: fund.id,
            buildingId,
            amountCents: dto.amountCents,
            source: dto.source,
            ...(dto.levyId ? { levyId: dto.levyId } : {}),
            ...(dto.notes ? { notes: dto.notes } : {}),
          },
        });
        const updatedFund = await tx.reserveFund.update({
          where: { id: fund.id },
          data: { balanceCents: { increment: dto.amountCents } },
        });
        return { contribution, fund: updatedFund };
      },
    );

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'reserve.contribution.created',
      entity: 'reserve_contribution',
      entityId: result.contribution.id,
      metadata: {
        amountCents: dto.amountCents,
        source: dto.source,
        levyId: dto.levyId ?? null,
      },
    });

    return result;
  }

  async drawdown(
    buildingId: string,
    dto: DrawdownDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!Number.isInteger(dto.amountCents) || dto.amountCents <= 0) {
      throw new BadRequestException('amountCents must be a positive integer');
    }
    const prismaAny = this.prisma as unknown as Record<string, any>;
    const fund = await this.getOrCreateFund(buildingId, user);

    if ((fund.balanceCents ?? 0) < dto.amountCents) {
      throw new BadRequestException('Insufficient reserve balance');
    }

    const result = await (this.prisma as any).$transaction(
      async (tx: Record<string, any>) => {
        // Re-check balance inside transaction to prevent race
        const current = await tx.reserveFund.findUnique({
          where: { id: fund.id },
        });
        if (!current || (current.balanceCents ?? 0) < dto.amountCents) {
          throw new BadRequestException('Insufficient reserve balance');
        }
        const drawdown = await tx.reserveDrawdown.create({
          data: {
            fundId: fund.id,
            buildingId,
            amountCents: dto.amountCents,
            reason: dto.reason,
            ...(dto.expenseId ? { expenseId: dto.expenseId } : {}),
          },
        });
        const updatedFund = await tx.reserveFund.update({
          where: { id: fund.id },
          data: { balanceCents: { decrement: dto.amountCents } },
        });
        return { drawdown, fund: updatedFund };
      },
    );

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'reserve.drawdown.created',
      entity: 'reserve_drawdown',
      entityId: result.drawdown.id,
      metadata: { amountCents: dto.amountCents, reason: dto.reason },
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Levies
  // -------------------------------------------------------------------------

  async createLevy(
    buildingId: string,
    dto: CreateLevyDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!ALLOWED_STRATEGIES.includes(dto.strategy as any)) {
      throw new BadRequestException(
        'strategy must be MILIMES, UNITS, CUSTOM, SQUARE_METERS or SHARE_FRACTION',
      );
    }
    if (!Number.isInteger(dto.totalCents) || dto.totalCents <= 0) {
      throw new BadRequestException('totalCents must be a positive integer');
    }

    const prismaAny = this.prisma as unknown as Record<string, any>;

    const units: Array<{
      id: string;
      millimes: number;
      squareMeters?: number | null;
      shareFraction?: number | null;
      label?: string;
    }> = await prismaAny.unit.findMany({
      where: { buildingId },
      orderBy: { label: 'asc' },
    });

    if (units.length === 0) {
      throw new BadRequestException('Building has no units to allocate to');
    }

    let weights: Array<{ id: string; weight: number }>;

    if (dto.strategy === 'MILIMES') {
      weights = units.map((u) => ({ id: u.id, weight: u.millimes }));
      const total = weights.reduce((s, w) => s + w.weight, 0);
      if (total <= 0) {
        throw new BadRequestException(
          'MILIMES strategy requires units with millimes > 0',
        );
      }
    } else if (dto.strategy === 'UNITS') {
      weights = units.map((u) => ({ id: u.id, weight: 1 }));
    } else if (dto.strategy === 'SQUARE_METERS') {
      weights = resolveAllocationWeights(
        units,
        AllocationStrategy.SQUARE_METERS,
      );
    } else if (dto.strategy === 'SHARE_FRACTION') {
      weights = resolveAllocationWeights(
        units,
        AllocationStrategy.SHARE_FRACTION,
      );
    } else {
      // CUSTOM
      if (!dto.customWeights || dto.customWeights.length === 0) {
        throw new BadRequestException(
          'customWeights required for CUSTOM strategy',
        );
      }
      const map = new Map<string, number>();
      for (const cw of dto.customWeights) {
        if (!cw.unitId || !Number.isInteger(cw.weight) || cw.weight <= 0) {
          throw new BadRequestException(
            'customWeights entries must have unitId and positive integer weight',
          );
        }
        map.set(cw.unitId, cw.weight);
      }
      // Ensure all units have a weight? If missing, treat missing as 0? We require all units?
      // For flexibility: require weights for at least one unit, but missing units get 0 and are excluded.
      // However task expects levy shares for all units. We'll ensure provided unitIds belong to building.
      for (const unitId of map.keys()) {
        if (!units.some((u) => u.id === unitId)) {
          throw new BadRequestException(`Unit ${unitId} does not belong to building`);
        }
      }
      // If customWeights covers subset, we allocate only to those units; others get 0 share but still may need share rows with 0?
      // Simpler: require all units covered for CUSTOM.
      if (map.size !== units.length) {
        throw new BadRequestException(
          'customWeights must cover all units of the building',
        );
      }
      weights = units.map((u) => ({
        id: u.id,
        weight: map.get(u.id) ?? 0,
      }));
      const total = weights.reduce((s, w) => s + w.weight, 0);
      if (total <= 0) {
        throw new BadRequestException('CUSTOM weights must sum to > 0');
      }
    }

    const splits = splitByLargestRemainder(dto.totalCents, weights);

    const levy = await (this.prisma as any).$transaction(
      async (tx: Record<string, any>) => {
        const created = await tx.extraordinaryLevy.create({
          data: {
            buildingId,
            title: dto.title.trim(),
            totalCents: dto.totalCents,
            strategy: dto.strategy,
            status: LEVY_STATUSES.DRAFT,
            ...(dto.voteId ? { voteId: dto.voteId } : {}),
          },
        });
        await tx.levyShare.createMany({
          data: splits.map((s) => ({
            levyId: created.id,
            unitId: s.id,
            amountCents: s.amountCents,
            paidCents: 0,
          })),
        });
        return tx.extraordinaryLevy.findUniqueOrThrow({
          where: { id: created.id },
          include: { shares: true },
        });
      },
    );

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'reserve.levy.created',
      entity: 'extraordinary_levy',
      entityId: levy.id,
      metadata: {
        title: levy.title,
        totalCents: levy.totalCents,
        strategy: levy.strategy,
      },
    });

    return levy;
  }

  async issueLevy(
    buildingId: string,
    levyId: string,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as unknown as Record<string, any>;

    const levy = await prismaAny.extraordinaryLevy.findFirst({
      where: { id: levyId, buildingId },
      include: { shares: true },
    });
    if (!levy) throw new NotFoundException('Levy not found');
    if (levy.status !== LEVY_STATUSES.DRAFT) {
      throw new BadRequestException('Only DRAFT levies can be issued');
    }

    const fund = await this.getOrCreateFund(buildingId, user);

    const result = await (this.prisma as any).$transaction(
      async (tx: Record<string, any>) => {
        const updated = await tx.extraordinaryLevy.update({
          where: { id: levy.id },
          data: { status: LEVY_STATUSES.ISSUED },
          include: { shares: true },
        });

        // Create contributions to reserve fund — one per share (detailed accounting)
        // and increment fund balance atomically.
        for (const share of levy.shares as Array<{ unitId: string; amountCents: number }>) {
          await tx.reserveContribution.create({
            data: {
              fundId: fund.id,
              buildingId,
              amountCents: share.amountCents,
              source: 'LEVY',
              levyId: levy.id,
              notes: `Έκτακτη εισφορά: ${levy.title}`,
            },
          });
        }

        const updatedFund = await tx.reserveFund.update({
          where: { id: fund.id },
          data: { balanceCents: { increment: levy.totalCents } },
        });

        return { levy: updated, fund: updatedFund };
      },
    );

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'reserve.levy.issued',
      entity: 'extraordinary_levy',
      entityId: levy.id,
      metadata: { totalCents: levy.totalCents, shares: levy.shares.length },
    });

    return result.levy;
  }

  async listLevies(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as unknown as Record<string, any>;
    return prismaAny.extraordinaryLevy.findMany({
      where: { buildingId },
      include: { shares: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLevyDetail(
    buildingId: string,
    levyId: string,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as unknown as Record<string, any>;
    const levy = await prismaAny.extraordinaryLevy.findFirst({
      where: { id: levyId, buildingId },
      include: { shares: { include: { unit: { select: { label: true } } } } },
    });
    if (!levy) throw new NotFoundException('Levy not found');
    return levy;
  }

  async closeLevy(
    buildingId: string,
    levyId: string,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as unknown as Record<string, any>;
    const levy = await prismaAny.extraordinaryLevy.findFirst({
      where: { id: levyId, buildingId },
    });
    if (!levy) throw new NotFoundException('Levy not found');
    if (levy.status !== LEVY_STATUSES.ISSUED) {
      throw new BadRequestException('Only ISSUED levies can be closed');
    }
    const updated = await prismaAny.extraordinaryLevy.update({
      where: { id: levy.id },
      data: { status: LEVY_STATUSES.CLOSED },
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'reserve.levy.closed',
      entity: 'extraordinary_levy',
      entityId: updated.id,
      metadata: { title: updated.title },
    });

    return updated;
  }
}
