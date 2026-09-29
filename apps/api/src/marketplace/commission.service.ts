import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CommissionSummaryDto,
  CommissionSummaryMonthDto,
  JobCommissionDto,
  JobCommissionStatus,
} from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeCommission,
  parseCommissionSettings,
  type CommissionSettings,
} from './commission-calc';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Minimal commission row needed by the summary aggregation. */
export interface CommissionVolumeRow {
  baseCents: number;
  amountCents: number;
  createdAt: Date;
}

/**
 * Zero-filled `YYYY-01`…`YYYY-12` monthly volume for the year, grouped by the
 * commission's `createdAt` month (≈ award time), plus totals.
 */
export function buildCommissionSummary(
  year: number,
  rows: CommissionVolumeRow[],
): CommissionSummaryDto {
  const months: CommissionSummaryMonthDto[] = Array.from(
    { length: 12 },
    (_, i) => ({
      month: `${year}-${pad2(i + 1)}`,
      awardedCents: 0,
      commissionCents: 0,
    }),
  );

  const totals = { awardedCents: 0, commissionCents: 0 };
  for (const row of rows) {
    const idx = row.createdAt.getUTCMonth();
    if (idx < 0 || idx > 11) continue;
    months[idx].awardedCents += row.baseCents;
    months[idx].commissionCents += row.amountCents;
    totals.awardedCents += row.baseCents;
    totals.commissionCents += row.amountCents;
  }

  return { year, months, totals };
}

interface CommissionRowLike {
  id: string;
  buildingId: string;
  jobId: string;
  providerId: string;
  baseCents: number;
  rateBps: number;
  amountCents: number;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
  job?: { title: string } | null;
  provider?: { firstName: string; lastName: string } | null;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

const COMMISSION_LIST_INCLUDE = {
  job: { select: { title: true } },
  provider: { select: { firstName: true, lastName: true } },
} as const;

@Injectable()
export class CommissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Rate/cap used at award time; env-driven with built-in defaults. */
  resolveSettings(): CommissionSettings {
    return parseCommissionSettings();
  }

  /**
   * Persists the platform commission for an awarded job. Idempotent per job
   * (unique `jobId`): an existing row short-circuits creation. Intended to be
   * called AFTER a successful award commit — callers treat failures as
   * non-fatal and only log them.
   */
  async createForAward(input: {
    buildingId: string;
    jobId: string;
    providerId: string;
    baseCents: number;
  }): Promise<JobCommissionDto | null> {
    const existing = await this.prisma.jobCommission.findUnique({
      where: { jobId: input.jobId },
    });
    if (existing) return this.toDto(existing);

    const settings = this.resolveSettings();
    const amountCents = computeCommission(
      input.baseCents,
      settings.rateBps,
      settings.capCents,
    );

    try {
      const row = await this.prisma.jobCommission.create({
        data: {
          buildingId: input.buildingId,
          jobId: input.jobId,
          providerId: input.providerId,
          baseCents: input.baseCents,
          rateBps: settings.rateBps,
          amountCents,
        },
      });
      this.audit.record({
        buildingId: input.buildingId,
        action: 'commission.create',
        entity: 'job_commission',
        entityId: row.id,
        metadata: {
          jobId: input.jobId,
          providerId: input.providerId,
          baseCents: input.baseCents,
          rateBps: settings.rateBps,
          amountCents,
        },
      });
      return this.toDto(row);
    } catch (error) {
      // Lost a race against another award of the same job: not an error.
      if (isUniqueConflict(error)) return null;
      throw error;
    }
  }

  /** Commissions newest-first; `status` optionally narrows the list. */
  async list(
    buildingId: string,
    user: AuthenticatedUser,
    status?: JobCommissionStatus,
  ): Promise<JobCommissionDto[]> {
    assertSameBuilding(user, buildingId);

    const rows = await this.prisma.jobCommission.findMany({
      where: { buildingId, ...(status ? { status } : {}) },
      include: {
        job: { select: { title: true } },
        provider: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.toDto(row));
  }

  /** DUE → PAID transition (idempotent); audited. */
  async markPaid(id: string, user: AuthenticatedUser): Promise<JobCommissionDto> {
    const row = await this.findOwned(id, user);
    if (row.status === 'PAID') return this.toDto(row);
    if (row.status !== 'DUE') {
      throw new BadRequestException(
        'Only due commissions can be marked as paid',
      );
    }

    const paidAt = new Date();
    const updated = await this.prisma.jobCommission.update({
      where: { id: row.id },
      data: { status: 'PAID', paidAt },
      include: COMMISSION_LIST_INCLUDE,
    });

    this.audit.record({
      buildingId: row.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'commission.mark-paid',
      entity: 'job_commission',
      entityId: row.id,
      metadata: {
        jobId: row.jobId,
        providerId: row.providerId,
        amountCents: row.amountCents,
        paidAt: paidAt.toISOString(),
      },
    });

    return this.toDto(updated);
  }

  /** DUE → WAIVED transition (idempotent); audited. */
  async waive(id: string, user: AuthenticatedUser): Promise<JobCommissionDto> {
    const row = await this.findOwned(id, user);
    if (row.status === 'WAIVED') return this.toDto(row);
    if (row.status !== 'DUE') {
      throw new BadRequestException('Only due commissions can be waived');
    }

    const updated = await this.prisma.jobCommission.update({
      where: { id: row.id },
      data: { status: 'WAIVED' },
      include: COMMISSION_LIST_INCLUDE,
    });

    this.audit.record({
      buildingId: row.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'commission.waive',
      entity: 'job_commission',
      entityId: row.id,
      metadata: {
        jobId: row.jobId,
        providerId: row.providerId,
        amountCents: row.amountCents,
      },
    });

    return this.toDto(updated);
  }

  /** Monthly commissionable volume for the year (award-time grouping). */
  async summary(
    buildingId: string,
    year: number,
    user: AuthenticatedUser,
  ): Promise<CommissionSummaryDto> {
    assertSameBuilding(user, buildingId);

    const rows = await this.prisma.jobCommission.findMany({
      where: {
        buildingId,
        createdAt: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      select: { baseCents: true, amountCents: true, createdAt: true },
    });

    return buildCommissionSummary(year, rows);
  }

  private async findOwned(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.jobCommission.findUnique({
      where: { id },
      include: COMMISSION_LIST_INCLUDE,
    });
    if (!row) throw new NotFoundException('Commission not found');
    assertSameBuilding(user, row.buildingId);
    return row;
  }

  private toDto(row: CommissionRowLike): JobCommissionDto {
    return {
      id: row.id,
      buildingId: row.buildingId,
      jobId: row.jobId,
      providerId: row.providerId,
      baseCents: row.baseCents,
      rateBps: row.rateBps,
      amountCents: row.amountCents,
      status: row.status as JobCommissionStatus,
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      jobTitle: row.job?.title ?? null,
      providerName: row.provider
        ? [row.provider.firstName, row.provider.lastName]
            .filter(Boolean)
            .join(' ') || null
        : null,
    };
  }
}
