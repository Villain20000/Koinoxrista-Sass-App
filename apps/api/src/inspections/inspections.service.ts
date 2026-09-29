import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';

export type InspectionResult = 'OK' | 'NG' | 'REPAIR_NEEDED';

export interface InspectionView {
  id: string;
  assetId: string;
  buildingId: string;
  inspectedAt: string;
  inspectorName: string | null;
  result: InspectionResult;
  photoKey: string | null;
  notes: string | null;
  jobId: string | null;
  createdAt: string;
}

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** List an asset's inspection history oldest-first. */
  async list(
    buildingId: string,
    assetId: string,
    user: AuthenticatedUser,
  ): Promise<InspectionView[]> {
    assertSameBuilding(user, buildingId);
    const asset = await this.prisma.buildingAsset.findFirst({
      where: { id: assetId, buildingId },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    const rows = await this.prisma.inspectionRecord.findMany({
      where: { assetId },
      include: { inspector: { select: { firstName: true, lastName: true } } },
      orderBy: { inspectedAt: 'asc' },
    });
    return rows.map((row) => this.toView(row));
  }

  /** Create an inspection record; NG/REPAIR_NEEDED suggests a follow-up job. */
  async create(
    buildingId: string,
    assetId: string,
    dto: {
      inspectedAt?: string;
      result: InspectionResult;
      photoKey?: string;
      notes?: string;
      jobId?: string;
    },
    user: AuthenticatedUser,
  ): Promise<InspectionView> {
    assertSameBuilding(user, buildingId);
    const asset = await this.prisma.buildingAsset.findFirst({
      where: { id: assetId, buildingId },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    if (!this.isAdminLike(user) && !this.isProviderForAsset(user, assetId)) {
      throw new ForbiddenException('Only admins or assigned providers can log inspections');
    }

    const inspectedAt = dto.inspectedAt ? new Date(dto.inspectedAt) : new Date();
    const relatedJobId =
      dto.jobId ??
      (await this.jobIdForAsset(buildingId, assetId));

    const created = await this.prisma.inspectionRecord.create({
      data: {
        assetId,
        buildingId,
        inspectedAt,
        inspectorId: user.id,
        result: dto.result,
        photoKey: dto.photoKey ?? null,
        notes: dto.notes ?? null,
        jobId: relatedJobId ?? null,
      },
      include: { inspector: { select: { firstName: true, lastName: true } } },
    });

    // A positive inspection refreshes the schedule's lastDoneAt.
    if (created.result === 'OK') {
      await this.refreshSchedule(assetId, inspectedAt);
    }

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'inspection.create',
      entity: 'inspection_record',
      entityId: created.id,
      metadata: { assetId, result: created.result },
    });
    return this.toView(created);
  }

  /** Admin removes an erroneous inspection record. */
  async remove(buildingId: string, id: string, user: AuthenticatedUser): Promise<void> {
    assertSameBuilding(user, buildingId);
    if (!this.isAdminLike(user)) {
      throw new ForbiddenException('Only admins can remove inspection records');
    }
    const record = await this.prisma.inspectionRecord.findFirst({
      where: { id, buildingId },
    });
    if (!record) throw new NotFoundException('Inspection record not found');
    await this.prisma.inspectionRecord.delete({ where: { id } });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'inspection.remove',
      entity: 'inspection_record',
      entityId: id,
      metadata: { assetId: record.assetId },
    });
  }

  /** Cost roll-up: Σ SupplierPayment for jobs linked to an asset. */
  async assetCost(
    buildingId: string,
    assetId: string,
    user: AuthenticatedUser,
  ): Promise<{ totalCents: number; byJob: Record<string, number> }> {
    assertSameBuilding(user, buildingId);
    const asset = await this.prisma.buildingAsset.findFirst({
      where: { id: assetId, buildingId },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    const jobIds = await this.jobsForAsset(buildingId, assetId);
    if (jobIds.length === 0) return { totalCents: 0, byJob: {} };
    const payments = await this.prisma.supplierPayment.findMany({
      where: { jobId: { in: jobIds } },
      select: { jobId: true, amountCents: true },
    });
    const byJob: Record<string, number> = {};
    let totalCents = 0;
    for (const payment of payments) {
      byJob[payment.jobId ?? ''] = (byJob[payment.jobId ?? ''] ?? 0) + payment.amountCents;
      totalCents += payment.amountCents;
    }
    return { totalCents, byJob };
  }

  private toView(row: {
    id: string;
    assetId: string;
    buildingId: string;
    inspectedAt: Date;
    result: string;
    photoKey: string | null;
    notes: string | null;
    jobId: string | null;
    createdAt: Date;
    inspector: { firstName: string; lastName: string } | null;
  }): InspectionView {
    return {
      id: row.id,
      assetId: row.assetId,
      buildingId: row.buildingId,
      inspectedAt: row.inspectedAt.toISOString(),
      inspectorName: row.inspector
        ? `${row.inspector.firstName} ${row.inspector.lastName}`.trim()
        : null,
      result: row.result as InspectionResult,
      photoKey: row.photoKey,
      notes: row.notes,
      jobId: row.jobId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private isAdminLike(user: AuthenticatedUser): boolean {
    return user.role === Role.ADMIN || user.role === Role.BUILDING_OWNER;
  }

  private async isProviderForAsset(
    user: AuthenticatedUser,
    assetId: string,
  ): Promise<boolean> {
    if (user.role !== Role.PROVIDER) return false;
    const jobIds = await this.jobsForAsset(user.buildingId ?? '', assetId);
    if (jobIds.length === 0) return false;
    const awarded = await this.prisma.bid.findFirst({
      where: { jobId: { in: jobIds }, providerUserId: user.id, status: 'AWARDED' },
      select: { id: true },
    });
    return !!awarded;
  }

  private async jobIdForAsset(
    buildingId: string,
    assetId: string,
  ): Promise<string | undefined> {
    const jobs = await this.jobsForAsset(buildingId, assetId);
    return jobs[0];
  }

  private async jobsForAsset(buildingId: string, assetId: string): Promise<string[]> {
    // Jobs linked to the asset are those referenced by prior inspection records
    // (jobId) — the maintenance↔job bridge. Falls back to empty when none yet.
    const records = await this.prisma.inspectionRecord.findMany({
      where: { assetId, buildingId, jobId: { not: null } },
      select: { jobId: true },
      distinct: ['jobId'],
    });
    return records.map((r) => r.jobId as string);
  }

  private async refreshSchedule(assetId: string, inspectedAt: Date): Promise<void> {
    const schedule = await this.prisma.maintenanceSchedule.findFirst({
      where: { assetId },
      orderBy: { nextDueAt: 'asc' },
    });
    if (!schedule) return;
    await this.prisma.maintenanceSchedule.update({
      where: { id: schedule.id },
      data: {
        lastDoneAt: inspectedAt,
        nextDueAt: this.addMonths(inspectedAt, schedule.intervalMonths),
      },
    });
  }

  private addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }
}

export function requireResult(value: string): InspectionResult {
  if (value !== 'OK' && value !== 'NG' && value !== 'REPAIR_NEEDED') {
    throw new BadRequestException('result must be OK | NG | REPAIR_NEEDED');
  }
  return value;
}