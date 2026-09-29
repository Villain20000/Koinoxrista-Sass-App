import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VoteTally, VoteChoice } from '@org/shared';
import {
  resolveOwnershipBasis,
  totalOwnershipWeight,
  unitOwnershipWeight,
} from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { tallyVote, TallyThresholdType } from '../votes/tally-vote';
import { SetOccupancyDto } from './dto/set-occupancy.dto';
import { UpsertEligibilityRuleDto } from './dto/upsert-rule.dto';

export type OccupantType = 'OWNER' | 'TENANT';
export type EligibilityCategory = 'GENERAL' | 'STRUCTURAL' | 'FINANCIAL';

export interface OccupancyRow {
  id: string;
  unitId: string;
  userId: string;
  shareMillimes: number;
  occupantType: OccupantType;
  votingEligible: boolean;
  residentRole: string | null;
  periodStart?: Date | string | null;
  user?: { firstName: string; lastName: string; email: string } | null;
}

export interface EligibilityRuleRow {
  id: string;
  buildingId: string;
  category: EligibilityCategory;
  allowedTypes: OccupantType[];
  requiresMillimes: boolean;
  createdAt: Date | string;
}

export interface EligibilityCheck {
  eligible: boolean;
  reason: string;
  occupantType?: OccupantType;
  votingEligible?: boolean;
  ruleCategory?: string;
  allowedTypes?: OccupantType[];
  requiresMillimes?: boolean;
}

export interface TallyInput {
  voteId: string;
  buildingId: string;
  thresholdType: string;
}

const VALID_OCCUPANT_TYPES: OccupantType[] = ['OWNER', 'TENANT'];
const VALID_CATEGORIES: EligibilityCategory[] = [
  'GENERAL',
  'STRUCTURAL',
  'FINANCIAL',
];

/**
 * Normalizes threshold type aliases to the tally engine's literals.
 * HEADCOUNT stays distinct (per-unit equal weights, no millimes).
 */
export function normalizeThreshold(
  raw: string,
): TallyThresholdType {
  if (raw === 'HEADCOUNT') return 'HEADCOUNT';
  if (raw === 'SIMPLE_MAJORITY' || raw === 'MILLIMES_MAJORITY')
    return raw as TallyThresholdType;
  return 'SIMPLE_MAJORITY';
}

/**
 * Pure helper: filters ballots + units to only the eligible voter pool.
 * Used by `computeEligibleTally` and unit-testable standalone.
 *
 * @param ballots - raw ballots for the vote
 * @param units - all units of the building
 * @param ownershipByUnit - map unitId -> occupancy row (or null)
 * @param rule - eligibility rule to enforce (defaults to OWNER only)
 * @returns filtered view + eligible totals
 */
export type EligibleWeightUnit = {
  id: string;
  millimes: number;
  squareMeters?: number | null;
  shareFraction?: number | null;
};

export function filterEligiblePool(
  ballots: { unitId: string; choice: string }[],
  units: EligibleWeightUnit[],
  ownershipByUnit: Map<string, { occupantType?: string; votingEligible?: boolean } | null>,
  rule: { allowedTypes?: string[]; requiresMillimes?: boolean } | null,
  equalWeight = rule?.requiresMillimes === false,
): {
  eligibleBallots: { unitId: string; choice: VoteChoice; millimes: number }[];
  eligibleUnits: EligibleWeightUnit[];
  totalEligibleMillimes: number;
} {
  const allowed = rule?.allowedTypes ?? ['OWNER'];
  const eligibleUnits = units.filter((unit) => {
    const occ = ownershipByUnit.get(unit.id);
    if (!occ) return false;
    const occupantType = (occ.occupantType ?? 'OWNER') as OccupantType;
    const votingEligible = occ.votingEligible ?? true;
    return votingEligible && allowed.includes(occupantType);
  });
  const eligibleUnitIds = new Set(eligibleUnits.map((u) => u.id));
  // P0-3: HEADCOUNT ignores ownership weights — every eligible unit counts
  // as one (per-unit equal weight). Otherwise weight by ownership share / area
  // when the building uses them.
  const basis = equalWeight ? 'MILLIMES' : resolveOwnershipBasis(units);
  const weightByUnit = new Map(
    units.map((u) => [u.id, equalWeight ? 1 : unitOwnershipWeight(u, basis)]),
  );
  const eligibleBallots = ballots
    .filter((b) => eligibleUnitIds.has(b.unitId))
    .map((b) => ({
      unitId: b.unitId,
      choice: b.choice as VoteChoice,
      millimes: weightByUnit.get(b.unitId) ?? 0,
    }));
  const totalEligibleMillimes = equalWeight
    ? eligibleUnits.length
    : totalOwnershipWeight(eligibleUnits, basis);
  return { eligibleBallots, eligibleUnits, totalEligibleMillimes };
}

/**
 * Pure helper that mirrors `tallyVote` but scopes to eligible pool.
 * Keeps quorum semantics consistent: participation uses only eligible ballots' millimes.
 */
export function computeEligibleTallyPure(
  thresholdType: TallyThresholdType,
  ballots: { unitId: string; choice: string }[],
  units: EligibleWeightUnit[],
  ownershipByUnit: Map<
    string,
    { occupantType?: string; votingEligible?: boolean } | null
  >,
  rule: { allowedTypes?: string[]; requiresMillimes?: boolean } | null,
): VoteTally {
  const effectiveThreshold =
    rule?.requiresMillimes === false || thresholdType === 'HEADCOUNT'
      ? 'HEADCOUNT'
      : normalizeThreshold(thresholdType as string);
  const { eligibleBallots, eligibleUnits, totalEligibleMillimes } =
    filterEligiblePool(
      ballots,
      units,
      ownershipByUnit,
      rule,
      effectiveThreshold === 'HEADCOUNT',
    );

  // For MILLIMES_MAJORITY we compare against eligible millimes,
  // for SIMPLE_MAJORITY threshold still uses counts.
  // tallyVote already branches on threshold internally.
  return tallyVote(
    effectiveThreshold,
    eligibleBallots.map((b) => ({ choice: b.choice, millimes: b.millimes })),
    eligibleUnits.length,
    totalEligibleMillimes,
  );
}

@Injectable()
export class TenancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Occupancy
  // ---------------------------------------------------------------------------

  async setOccupancy(
    buildingId: string,
    unitId: string,
    dto: SetOccupancyDto,
    user: AuthenticatedUser,
  ): Promise<OccupancyRow> {
    assertSameBuilding(user, buildingId);
    if (!VALID_OCCUPANT_TYPES.includes(dto.occupantType)) {
      throw new BadRequestException('occupantType must be OWNER or TENANT');
    }

    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
    });
    if (!unit || unit.buildingId !== buildingId) {
      throw new NotFoundException('Unit not found in this building');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!targetUser) throw new NotFoundException('User not found');
    if (targetUser.buildingId && targetUser.buildingId !== buildingId) {
      throw new ForbiddenException('User belongs to another building');
    }

    const votingEligible = dto.votingEligible ?? true;
    const residentRole = dto.residentRole ?? null;

    // Find existing ownership for this pair
    const existing = await (this.prisma as any).ownership.findFirst?.({
      where: { unitId, userId: dto.userId },
    });

    let row: OccupancyRow;
    if (existing) {
      // Update existing ownership with occupancy fields
      row = await (this.prisma as any).ownership.update({
        where: { id: existing.id },
        data: {
          occupantType: dto.occupantType,
          votingEligible,
          residentRole,
          ...(dto.shareMillimes !== undefined
            ? { shareMillimes: dto.shareMillimes }
            : {}),
          ...(dto.periodStart !== undefined
            ? {
                periodStart: dto.periodStart
                  ? new Date(dto.periodStart)
                  : null,
              }
            : {}),
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      });
    } else {
      // Need shareMillimes for creation — default to remainder of unit or 1
      let shareMillimes = dto.shareMillimes;
      if (shareMillimes === undefined) {
        const aggregate = await (this.prisma as any).ownership.aggregate?.({
          where: { unitId },
          _sum: { shareMillimes: true },
        });
        const allocated = aggregate?._sum?.shareMillimes ?? 0;
        const remaining = unit.millimes - allocated;
        shareMillimes = remaining > 0 ? remaining : 1;
        if (shareMillimes <= 0) {
          throw new BadRequestException(
            `No millimes remaining on unit ${unit.label}: allocated ${allocated} / ${unit.millimes}`,
          );
        }
      }

      // Ensure building linkage for building-less user
      if (!targetUser.buildingId) {
        await (this.prisma as any).user.update({
          where: { id: targetUser.id },
          data: { buildingId },
        });
      }

      row = await (this.prisma as any).ownership.create({
        data: {
          unitId,
          userId: dto.userId,
          shareMillimes,
          occupantType: dto.occupantType,
          votingEligible,
          residentRole,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      });
    }

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'tenancy.occupancy.set',
      entity: 'ownership',
      entityId: row.id,
      metadata: {
        unitId,
        userId: dto.userId,
        occupantType: dto.occupantType,
        votingEligible,
        residentRole,
      },
    });

    return this.normalizeOccupancy(row);
  }

  async getUnitOccupants(
    buildingId: string,
    unitId: string,
    user: AuthenticatedUser,
  ): Promise<OccupancyRow[]> {
    assertSameBuilding(user, buildingId);

    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
    });
    if (!unit || unit.buildingId !== buildingId) {
      throw new NotFoundException('Unit not found in this building');
    }

    const rows: OccupancyRow[] = await (this.prisma as any).ownership.findMany({
      where: { unitId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { id: 'asc' },
    });

    return rows.map((r) => this.normalizeOccupancy(r));
  }

  // ---------------------------------------------------------------------------
  // Eligibility rules
  // ---------------------------------------------------------------------------

  async getEligibilityRules(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<EligibilityRuleRow[]> {
    assertSameBuilding(user, buildingId);
    const rules: EligibilityRuleRow[] = await (this.prisma as any)
      .votingEligibilityRule?.findMany?.({
      where: { buildingId },
      orderBy: { category: 'asc' },
    }) ?? [];
    return rules.map((r) => this.normalizeRule(r));
  }

  async upsertRule(
    buildingId: string,
    dto: UpsertEligibilityRuleDto,
    user: AuthenticatedUser,
  ): Promise<EligibilityRuleRow> {
    assertSameBuilding(user, buildingId);

    if (!VALID_CATEGORIES.includes(dto.category)) {
      throw new BadRequestException(
        'category must be GENERAL, STRUCTURAL or FINANCIAL',
      );
    }
    if (!Array.isArray(dto.allowedTypes) || dto.allowedTypes.length === 0) {
      throw new BadRequestException('allowedTypes must be non-empty');
    }
    for (const t of dto.allowedTypes) {
      if (!VALID_OCCUPANT_TYPES.includes(t)) {
        throw new BadRequestException('allowedTypes may only contain OWNER or TENANT');
      }
    }
    // dedupe
    const allowedTypes = [...new Set(dto.allowedTypes)] as OccupantType[];
    const requiresMillimes = dto.requiresMillimes ?? true;

    const existing = await (this.prisma as any).votingEligibilityRule?.findFirst?.({
      where: { buildingId, category: dto.category },
    });

    let row: EligibilityRuleRow;
    if (existing) {
      row = await (this.prisma as any).votingEligibilityRule.update({
        where: { id: existing.id },
        data: { allowedTypes, requiresMillimes },
      });
    } else {
      row = await (this.prisma as any).votingEligibilityRule.create({
        data: {
          buildingId,
          category: dto.category,
          allowedTypes,
          requiresMillimes,
        },
      });
    }

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'tenancy.rule.upsert',
      entity: 'voting_eligibility_rule',
      entityId: row.id,
      metadata: {
        category: dto.category,
        allowedTypes,
        requiresMillimes,
      },
    });

    return this.normalizeRule(row);
  }

  // ---------------------------------------------------------------------------
  // Voting eligibility check
  // ---------------------------------------------------------------------------

  async checkCanVote(
    buildingId: string,
    voteId: string,
    unitId: string,
    user: AuthenticatedUser,
  ): Promise<EligibilityCheck> {
    assertSameBuilding(user, buildingId);

    const vote = await this.prisma.vote.findUnique({
      where: { id: voteId },
    });
    if (!vote) throw new NotFoundException('Vote not found');
    if (vote.buildingId !== buildingId) {
      throw new ForbiddenException('Vote belongs to another building');
    }

    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
    });
    if (!unit || unit.buildingId !== buildingId) {
      throw new NotFoundException('Unit not found in this building');
    }

    const ownerships: OccupancyRow[] =
      await (this.prisma as any).ownership.findMany?.({
        where: { unitId },
      }) ?? [];

    if (ownerships.length === 0) {
      return { eligible: false, reason: 'NO_OCCUPANT' };
    }

    // Pick primary occupancy — votingEligible false on any row means not eligible if single-occupant.
    // If multiple occupants, unit is eligible if ANY occupant is eligible and allowed.
    // We return the most permissive.
    const rules = await (this.prisma as any).votingEligibilityRule?.findMany?.({
      where: { buildingId },
    }) ?? [];

    // Derive rule: map thresholdType to category
    // GENERAL is default, FINANCIAL for millimes votes, STRUCTURAL not inferred automatically
    let targetCategory: EligibilityCategory = 'GENERAL';
    const threshold = normalizeThreshold(vote.thresholdType);
    if (threshold === 'MILLIMES_MAJORITY') {
      // Prefer FINANCIAL rule if exists, else GENERAL
      if (rules.some((r: any) => r.category === 'FINANCIAL')) {
        targetCategory = 'FINANCIAL';
      }
    }

    let rule =
      rules.find((r: any) => r.category === targetCategory) ??
      rules.find((r: any) => r.category === 'GENERAL') ??
      null;

    // Default rule when none configured: OWNER only, requiresMillimes = threshold is millimes
    if (!rule) {
      rule = {
        category: targetCategory,
        allowedTypes: ['OWNER'],
        requiresMillimes: threshold === 'MILLIMES_MAJORITY',
      } as any;
    }

    const allowed = (rule as any).allowedTypes as OccupantType[];

    // Check any occupant qualifies
    for (const occ of ownerships) {
      const occAny = occ as any;
      const occupantType = (occAny.occupantType ?? 'OWNER') as OccupantType;
      const votingEligible = occAny.votingEligible ?? true;
      if (!votingEligible) continue;
      if (allowed.includes(occupantType)) {
        return {
          eligible: true,
          reason: 'ELIGIBLE',
          occupantType,
          votingEligible,
          ruleCategory: (rule as any).category,
          allowedTypes: allowed,
          requiresMillimes: (rule as any).requiresMillimes,
        };
      }
    }

    // If none matched, pick first occupant to explain why
    const first = ownerships[0] as any;
    const occupantType = (first.occupantType ?? 'OWNER') as OccupantType;
    const votingEligible = first.votingEligible ?? true;
    if (!votingEligible) {
      return {
        eligible: false,
        reason: 'NOT_VOTING_ELIGIBLE',
        occupantType,
        votingEligible,
        ruleCategory: (rule as any).category,
        allowedTypes: allowed,
        requiresMillimes: (rule as any).requiresMillimes,
      };
    }
    return {
      eligible: false,
      reason: 'OCCUPANT_TYPE_NOT_ALLOWED',
      occupantType,
      votingEligible,
      ruleCategory: (rule as any).category,
      allowedTypes: allowed,
      requiresMillimes: (rule as any).requiresMillimes,
    };
  }

  /**
   * Computes a tally scoped to eligible voters only. Intended to be called
   * from `VotesService.close` / `VotesService.get` as:
   *   const tally = await tenancyService.computeEligibleTally(buildingId, voteId, user)
   * and to replace the vanilla `computeTally` when the tenancy matrix is active.
   */
  async computeEligibleTally(
    buildingId: string,
    voteId: string,
    user: AuthenticatedUser,
  ): Promise<VoteTally> {
    assertSameBuilding(user, buildingId);

    const vote = await this.prisma.vote.findUnique({
      where: { id: voteId },
    });
    if (!vote) throw new NotFoundException('Vote not found');
    if (vote.buildingId !== buildingId) {
      throw new ForbiddenException('Vote belongs to another building');
    }

    const [units, ballots, ownerships, rules] = await Promise.all([
      this.prisma.unit.findMany({
        where: { buildingId },
        select: {
          id: true,
          millimes: true,
          squareMeters: true,
          shareFraction: true,
        },
      }),
      this.prisma.ballot.findMany({ where: { voteId } }),
      (this.prisma as any).ownership.findMany?.({
        where: { unit: { buildingId } },
        select: { unitId: true, occupantType: true, votingEligible: true },
      }) ?? [],
      (this.prisma as any).votingEligibilityRule?.findMany?.({
        where: { buildingId },
      }) ?? [],
    ]);

    const ownershipByUnit = new Map<
      string,
      { occupantType?: string; votingEligible?: boolean } | null
    >();
    // If multiple ownerships per unit, unit is eligible if ANY occupant is eligible/allowed,
    // so we store the most permissive occupant per unit for pool computation.
    // Simpler: keep first eligible if exists else first.
    const byUnit = new Map<string, typeof ownerships>();
    for (const o of ownerships) {
      const arr = byUnit.get((o as any).unitId) ?? [];
      arr.push(o);
      byUnit.set((o as any).unitId, arr);
    }
    for (const unit of units) {
      const list = byUnit.get(unit.id) ?? [];
      if (list.length === 0) {
        ownershipByUnit.set(unit.id, null);
        continue;
      }
      // Prefer a votingEligible OWNER if multiple?
      // For pool filtering we need to know if unit is in eligible set — checkCanVote logic above.
      // Reuse same rule decision per unit inside filterEligiblePool.
      // To honor that, we store a synthetic occupant that represents "any qualifies".
      // Instead of picking one, we will later treat unit as eligible if any occupant qualifies.
      // For filterEligiblePool we need single occupant per unit; we synthesize.
      // Pick occupant that would pass rule if possible.
      // To keep pure function simple, we store the first occupant but filter will check single value.
      // So instead, precompute eligibility per unit using rules.
      let targetCategory: EligibilityCategory = 'GENERAL';
      const thr = normalizeThreshold(vote.thresholdType);
      if (thr === 'MILLIMES_MAJORITY') {
        if (rules.some((r: any) => r.category === 'FINANCIAL')) {
          targetCategory = 'FINANCIAL';
        }
      }
      let rule =
        rules.find((r: any) => r.category === targetCategory) ??
        rules.find((r: any) => r.category === 'GENERAL') ??
        null;
      if (!rule) {
        rule = {
          category: targetCategory,
          allowedTypes: ['OWNER'],
          requiresMillimes: thr === 'MILLIMES_MAJORITY',
        } as any;
      }
      const allowed = (rule as any).allowedTypes as string[];
      const eligibleOcc = list.find((o: any) => {
        const t = (o.occupantType ?? 'OWNER') as string;
        const ve = o.votingEligible ?? true;
        return ve && allowed.includes(t);
      });
      const chosen = eligibleOcc ?? list[0];
      ownershipByUnit.set(unit.id, {
        occupantType: (chosen as any).occupantType ?? 'OWNER',
        votingEligible: (chosen as any).votingEligible ?? true,
      });
      // If chosen is ineligible but another could be eligible, we actually already picked eligible one if exists.
      // If no eligible exists, chosen will be ineligible and filter will exclude unit correctly.
      // But if there are multiple and one is eligible and one is not, we want unit to be eligible.
      // Since we picked eligibleOcc first, unit will be kept.
    }

    // Derive effective rule for tally weighting
    let targetCategory: EligibilityCategory = 'GENERAL';
    const norm = normalizeThreshold(vote.thresholdType);
    if (norm === 'MILLIMES_MAJORITY') {
      if (rules.some((r: any) => r.category === 'FINANCIAL')) {
        targetCategory = 'FINANCIAL';
      }
    }
    let rule =
      rules.find((r: any) => r.category === targetCategory) ??
      rules.find((r: any) => r.category === 'GENERAL') ??
      null;
    if (!rule) {
      rule = {
        category: targetCategory,
        allowedTypes: ['OWNER'],
        requiresMillimes: norm === 'MILLIMES_MAJORITY',
      } as any;
    }

    return computeEligibleTallyPure(
      vote.thresholdType as TallyThresholdType,
      ballots as any,
      units,
      ownershipByUnit,
      rule as any,
    );
  }

  private normalizeOccupancy(row: any): OccupancyRow {
    return {
      id: row.id,
      unitId: row.unitId,
      userId: row.userId,
      shareMillimes: row.shareMillimes,
      occupantType: (row.occupantType ?? 'OWNER') as OccupantType,
      votingEligible: row.votingEligible ?? true,
      residentRole: row.residentRole ?? null,
      periodStart: row.periodStart ?? null,
      user: row.user ?? null,
    };
  }

  private normalizeRule(row: any): EligibilityRuleRow {
    return {
      id: row.id,
      buildingId: row.buildingId,
      category: row.category as EligibilityCategory,
      allowedTypes: (row.allowedTypes ?? ['OWNER']) as OccupantType[],
      requiresMillimes: row.requiresMillimes ?? true,
      createdAt: row.createdAt,
    };
  }
}
