import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export type AlertMetric =
  | 'COLLECTION_RATE'
  | 'ARREARS_WOW'
  | 'DEFECTS_7D'
  | 'PSP_FAILURES';

export interface SnapshotView {
  id: string;
  buildingId: string;
  weekStart: string;
  invoicedCents: number;
  collectedCents: number;
  arrearsCents: number;
  arrearsUnits: number;
  collectionRate: number;
  openJobs: number;
  newDefects: number;
  createdAt: string;
}

const MS_PER_DAY = 86_400_000;

@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Monday (UTC) of the given date. */
  static weekStartOf(date: Date): Date {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = d.getUTCDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day); // Monday
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
  }

  /** Compute + upsert the weekly snapshot for a building. Idempotent per weekStart. */
  async snapshot(buildingId: string, weekStart?: Date): Promise<SnapshotView> {
    const start = weekStart ?? KpiService.weekStartOf(new Date());
    const end = new Date(start.getTime() + 7 * MS_PER_DAY);

    const invoices = await this.prisma.invoice.findMany({
      where: { buildingId, createdAt: { gte: start, lt: end } },
      select: { totalCents: true, paidCents: true },
    });
    const invoicedCents = invoices.reduce((sum, inv) => sum + inv.totalCents, 0);
    const collectedCents = invoices.reduce((sum, inv) => sum + inv.paidCents, 0);

    const arrears = await this.arrearsTotals(buildingId);

    const openJobs = await this.prisma.job.count({
      where: { buildingId, status: 'OPEN' },
    });
    const defects = await this.prisma.job.count({
      where: {
        buildingId,
        source: 'RESIDENT_REPORT',
        createdAt: { gte: start, lt: end },
      },
    });

    const collectionRate = invoicedCents > 0 ? collectedCents / invoicedCents : 0;
    const saved = await this.prisma.buildingWeeklySnapshot.upsert({
      where: { buildingId_weekStart: { buildingId, weekStart: start } },
      create: {
        buildingId,
        weekStart: start,
        invoicedCents,
        collectedCents,
        arrearsCents: arrears.total,
        arrearsUnits: arrears.units,
        collectionRate,
        openJobs,
        newDefects: defects,
      },
      update: {
        invoicedCents,
        collectedCents,
        arrearsCents: arrears.total,
        arrearsUnits: arrears.units,
        collectionRate,
        openJobs,
        newDefects: defects,
      },
    });
    return this.toView(saved);
  }

  /** Compute + backfill snapshots for the last 8 weeks. */
  async backfill(buildingId: string): Promise<number> {
    const now = new Date();
    let count = 0;
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now.getTime() - i * 7 * MS_PER_DAY);
      const week = KpiService.weekStartOf(start);
      await this.snapshot(buildingId, week);
      count++;
    }
    return count;
  }

  list(buildingId: string, user: AuthenticatedUser, weeks = 12): Promise<SnapshotView[]> {
    assertSameBuilding(user, buildingId);
    const since = new Date(Date.now() - weeks * 7 * MS_PER_DAY);
    return this.prisma.buildingWeeklySnapshot
      .findMany({ where: { buildingId, weekStart: { gte: since } }, orderBy: { weekStart: 'asc' } })
      .then((rows) => rows.map((row) => this.toView(row)));
  }

  // --- Alert rules ---

  async listRules(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    return this.prisma.alertRule.findMany({ where: { buildingId }, orderBy: { metric: 'asc' } });
  }

  async upsertRule(
    buildingId: string,
    dto: { metric: AlertMetric; threshold: number; window?: string; active?: boolean },
    user: AuthenticatedUser,
  ): Promise<void> {
    assertSameBuilding(user, buildingId);
    if (!['COLLECTION_RATE', 'ARREARS_WOW', 'DEFECTS_7D', 'PSP_FAILURES'].includes(dto.metric)) {
      throw new BadRequestException(`Unsupported metric: ${dto.metric}`);
    }
    const existing = await this.prisma.alertRule.findUnique({
      where: { buildingId_metric: { buildingId, metric: dto.metric } },
    });
    if (existing) {
      await this.prisma.alertRule.update({
        where: { id: existing.id },
        data: {
          threshold: dto.threshold,
          ...(dto.window ? { window: dto.window } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
    } else {
      await this.prisma.alertRule.create({
        data: {
          buildingId,
          metric: dto.metric,
          threshold: dto.threshold,
          window: dto.window ?? '7d',
          active: dto.active ?? true,
        },
      });
    }
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'kpi.alert_rule.upsert',
      entity: 'alert_rule',
      entityId: existing?.id ?? null,
      metadata: { metric: dto.metric, threshold: dto.threshold },
    });
  }

  /** Run anomaly checks against active rules; fires notifications, de-duped by lastFiredAt. */
  async checkAnomalies(buildingId: string, user?: AuthenticatedUser): Promise<{ fired: string[] }> {
    const rules = await this.prisma.alertRule.findMany({
      where: { buildingId, active: true },
    });
    const fired: string[] = [];
    const [latest, prior] = await Promise.all([
      this.latestSnapshot(buildingId),
      this.priorSnapshot(buildingId),
    ]);

    for (const rule of rules) {
      const shouldFire = await this.evaluate(buildingId, rule.metric, rule.threshold, latest, prior);
      if (!shouldFire) continue;
      if (rule.lastFiredAt && Date.now() - rule.lastFiredAt.getTime() < 7 * MS_PER_DAY) continue;
      await this.prisma.alertRule.update({ where: { id: rule.id }, data: { lastFiredAt: new Date() } });
      await this.alertAdmins(buildingId, rule.metric, rule.threshold);
      fired.push(rule.metric);
    }
    return { fired };
  }

  private async evaluate(
    buildingId: string,
    metric: string,
    threshold: number,
    latest: { collectionRate: number; arrearsCents: number; newDefects: number } | null,
    prior: { collectionRate: number; arrearsCents: number } | null,
  ): Promise<boolean> {
    if (!latest) return false;
    switch (metric) {
      case 'COLLECTION_RATE':
        // Collection rate below threshold for 2 consecutive weeks.
        return latest.collectionRate < threshold / 100 && (prior?.collectionRate ?? 1) < threshold / 100;
      case 'ARREARS_WOW': {
        if (!prior || prior.arrearsCents === 0) return false;
        const wow = (latest.arrearsCents - prior.arrearsCents) / prior.arrearsCents;
        return wow >= threshold / 100;
      }
      case 'DEFECTS_7D':
        return latest.newDefects >= threshold;
      case 'PSP_FAILURES':
        // Naive: treat as triggered when configured (no aggregated failure counter yet).
        return false;
      default:
        return false;
    }
  }

  private async alertAdmins(buildingId: string, metric: string, threshold: number): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.BUILDING_OWNER] }, buildingId },
      select: { id: true },
    });
    const label = metricLabel(metric);
    for (const admin of admins) {
      await this.notifications.create({
        userId: admin.id,
        type: 'kpi.anomaly',
        title: `Ανιχνεύθηκε ανωμαλία: ${label}`,
        body: `${label} ξεπέρασε το όριο (${threshold}).`,
        linkPath: '/admin/analytics',
      });
    }
  }

  private async arrearsTotals(buildingId: string): Promise<{ total: number; units: number }> {
    const invoices = await this.prisma.invoice.findMany({
      where: { buildingId },
      select: { unitId: true, totalCents: true, paidCents: true },
    });
    const units = new Map<string, number>();
    for (const inv of invoices) {
      const outstanding = inv.totalCents - inv.paidCents;
      if (outstanding <= 0) continue;
      units.set(inv.unitId, (units.get(inv.unitId) ?? 0) + outstanding);
    }
    return { total: [...units.values()].reduce((sum, v) => sum + v, 0), units: units.size };
  }

  /** Local tabular forecast: risk per unit based on last 6 months invoices (no LLM). */
  async forecastArrears(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<{ buildingId: string; generatedAt: string; units: { unitId: string; label: string; risk: number; overdueCents: number; totalCents: number; collectionRate: number }[] }> {
    assertSameBuilding(user, buildingId);
    const since = new Date(Date.now() - 180 * MS_PER_DAY);
    const invoices = await this.prisma.invoice.findMany({
      where: { buildingId, createdAt: { gte: since } },
      select: { unitId: true, totalCents: true, paidCents: true, unit: { select: { label: true } } },
    });
    const byUnit = new Map<string, { label: string; total: number; paid: number; overdue: number; count: number }>();
    for (const inv of invoices) {
      const cur = byUnit.get(inv.unitId) ?? { label: (inv.unit as unknown as { label: string })?.label ?? inv.unitId, total: 0, paid: 0, overdue: 0, count: 0 };
      cur.total += inv.totalCents;
      cur.paid += inv.paidCents;
      const out = inv.totalCents - inv.paidCents;
      if (out > 0) cur.overdue += out;
      cur.count += 1;
      byUnit.set(inv.unitId, cur);
    }
    // Include units with zero invoices (risk 0)
    const allUnits = await this.prisma.unit.findMany({ where: { buildingId }, select: { id: true, label: true } });
    for (const u of allUnits) {
      if (!byUnit.has(u.id)) byUnit.set(u.id, { label: u.label, total: 0, paid: 0, overdue: 0, count: 0 });
    }

    const units = [...byUnit.entries()]
      .map(([unitId, v]) => {
        const collectionRate = v.total > 0 ? v.paid / v.total : 1;
        const overdueRatio = v.total > 0 ? v.overdue / v.total : 0;
        // Simple logistic-like: 0.5*(1-collectionRate) + 0.5*overdueRatio, boosted if count>=3 and overdue>0
        let risk = 0.5 * (1 - collectionRate) + 0.5 * overdueRatio;
        if (v.count >= 3 && v.overdue > 0) risk = Math.min(1, risk + 0.15);
        if (v.count === 0) risk = 0;
        return {
          unitId,
          label: v.label,
          risk: Math.round(risk * 100) / 100,
          overdueCents: v.overdue,
          totalCents: v.total,
          collectionRate: Math.round(collectionRate * 100) / 100,
        };
      })
      .sort((a, b) => b.risk - a.risk || b.overdueCents - a.overdueCents);

    return { buildingId, generatedAt: new Date().toISOString(), units };
  }

  private async latestSnapshot(buildingId: string) {
    return this.prisma.buildingWeeklySnapshot.findFirst({
      where: { buildingId },
      orderBy: { weekStart: 'desc' },
    });
  }

  private async priorSnapshot(buildingId: string) {
    const rows = await this.prisma.buildingWeeklySnapshot.findMany({
      where: { buildingId },
      orderBy: { weekStart: 'desc' },
      take: 2,
    });
    return rows[1] ?? null;
  }

  private toView(row: {
    id: string;
    buildingId: string;
    weekStart: Date;
    invoicedCents: number;
    collectedCents: number;
    arrearsCents: number;
    arrearsUnits: number;
    collectionRate: number;
    openJobs: number;
    newDefects: number;
    createdAt: Date;
  }): SnapshotView {
    return {
      id: row.id,
      buildingId: row.buildingId,
      weekStart: row.weekStart.toISOString(),
      invoicedCents: row.invoicedCents,
      collectedCents: row.collectedCents,
      arrearsCents: row.arrearsCents,
      arrearsUnits: row.arrearsUnits,
      collectionRate: row.collectionRate,
      openJobs: row.openJobs,
      newDefects: row.newDefects,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function metricLabel(metric: string): string {
  switch (metric) {
    case 'COLLECTION_RATE':
      return 'Ποσοστό είσπραξης';
    case 'ARREARS_WOW':
      return 'Αύξηση οφειλών';
    case 'DEFECTS_7D':
      return 'Νέες βλάβες';
    case 'PSP_FAILURES':
      return 'Αποτυχίες πληρωμών';
    default:
      return metric;
  }
}