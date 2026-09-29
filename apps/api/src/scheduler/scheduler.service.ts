import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Cron } from '@nestjs/schedule';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ComplianceService } from '../compliance/compliance.service';
import { InvoicesService } from '../invoices/invoices.service';
import { LateFeesService } from '../late-fees/late-fees.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { RecurringService } from '../recurring/recurring.service';
import { RemindersService } from '../reminders/reminders.service';
import { VotesService } from '../votes/votes.service';
import { PrismaService } from '../prisma/prisma.service';

export type SchedulerJobType =
  | 'invoice_run'
  | 'recurring_gen'
  | 'late_fee'
  | 'reminders'
  | 'maintenance_jobs'
  | 'compliance_check'
  | 'vote_close';

/** Disable all cron execution unless the single-job-replica gate is on. */
const ENABLED = process.env.JOB_SCHEDULER_ENABLED === 'true';

export interface JobRunView {
  id: string;
  buildingId: string | null;
  jobType: SchedulerJobType;
  period: string | null;
  status: string;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly invoices: InvoicesService,
    private readonly recurring: RecurringService,
    private readonly lateFees: LateFeesService,
    private readonly reminders: RemindersService,
    private readonly maintenance: MaintenanceService,
    private readonly compliance: ComplianceService,
    private readonly votes: VotesService,
  ) {}

  onModuleInit(): void {
    void this.logger.log(
      `Scheduler ${ENABLED ? 'enabled' : 'disabled'} (set JOB_SCHEDULER_ENABLED=true on the job replica)`,
    );
  }

  private buildingActor(buildingId: string): AuthenticatedUser {
    return {
      id: '__scheduler__',
      email: 'scheduler@system',
      role: Role.BUILDING_OWNER,
      buildingId,
    };
  }

  private async allBuildingIds(): Promise<string[]> {
    const rows = await this.prisma.building.findMany({ select: { id: true } });
    return rows.map((building) => building.id);
  }

  /**
   * Runs `jobType` for every building. Returns early (no-op) when a JobRun row
   * with the same (buildingId, jobType, period) already exists so a rerun or a
   * second replica never double-executes.
   */
  private async runForAllBuildings(
    jobType: SchedulerJobType,
    period: string | null,
    fn: (buildingId: string, user: AuthenticatedUser) => Promise<unknown>,
  ): Promise<void> {
    if (!ENABLED) return;

    for (const buildingId of await this.allBuildingIds()) {
      const existing = await this.prisma.jobRun.findFirst({
        where: { buildingId, jobType, period },
      });
      if (existing) continue;

      const run = await this.prisma.jobRun.create({
        data: { buildingId, jobType, period, status: 'RUNNING' },
      });

      const startedAt = new Date();
      try {
        const result = await fn(buildingId, this.buildingActor(buildingId));
        await this.prisma.jobRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCESS',
            message: safeMessage(result),
            finishedAt: new Date(),
          },
        });
        this.audit.record({
          buildingId,
          actorId: null,
          action: `scheduler.${jobType}`,
          entity: 'job_run',
          entityId: run.id,
          metadata: { period, startedAt: startedAt.toISOString() },
        });
      } catch (error) {
        await this.prisma.jobRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            message: error instanceof Error ? error.message : String(error),
            finishedAt: new Date(),
          },
        });
        this.logger.error(
          `scheduler ${jobType} failed for building ${buildingId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /** Previous `YYYY-MM` relative to now. */
  private previousMonthKey(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  @Cron('0 6 1 * *')
  async invoiceRun(): Promise<void> {
    const period = this.previousMonthKey();
    await this.runForAllBuildings(
      'invoice_run',
      period,
      (buildingId, user) => this.invoices.run(buildingId, { periodYearMonth: period }, user),
    );
  }

  @Cron('0 7 1 * *')
  async recurringGen(): Promise<void> {
    const period = this.previousMonthKey();
    await this.runForAllBuildings(
      'recurring_gen',
      period,
      (buildingId, user) => this.recurring.generate(buildingId, period, user),
    );
  }

  @Cron('0 8 1 * *')
  async lateFeeRun(): Promise<void> {
    const period = this.previousMonthKey();
    await this.runForAllBuildings(
      'late_fee',
      period,
      (buildingId, user) => this.lateFees.run(buildingId, { month: period }, user),
    );
  }

  @Cron('0 9 * * *')
  async remindersRun(): Promise<void> {
    await this.runForAllBuildings(
      'reminders',
      null,
      (buildingId, user) => this.reminders.send(buildingId, undefined, user),
    );
  }

  @Cron('30 9 * * *')
  async maintenanceJobs(): Promise<void> {
    await this.runForAllBuildings(
      'maintenance_jobs',
      null,
      (buildingId, user) => this.maintenance.generateDueJobs(buildingId, user),
    );
  }

  @Cron('0 10 * * *')
  async complianceCheck(): Promise<void> {
    await this.runForAllBuildings(
      'compliance_check',
      null,
      (buildingId, user) => this.compliance.checkExpiries(buildingId, user),
    );
  }

  /** Feature 4: auto-close + tally every overdue, un-closed vote (every 10 min). */
  @Cron('*/10 * * * *')
  async voteClose(): Promise<void> {
    if (!ENABLED) return;
    const overdue = await this.prisma.vote.findMany({
      where: { closesAt: { lt: new Date() }, result: null },
    });
    for (const vote of overdue) {
      const keyed = {
        buildingId: vote.buildingId,
        jobType: 'vote_close' as const,
        period: vote.id,
      };
      const existing = await this.prisma.jobRun.findUnique({
        where: { buildingId_jobType_period: keyed },
      });
      if (existing) continue;

      const run = await this.prisma.jobRun.create({
        data: {
          buildingId: vote.buildingId,
          jobType: 'vote_close',
          period: vote.id,
          status: 'RUNNING',
        },
      });
      try {
        await this.votes.close(vote.id, this.buildingActor(vote.buildingId));
        await this.prisma.jobRun.update({
          where: { id: run.id },
          data: { status: 'SUCCESS', message: vote.id, finishedAt: new Date() },
        });
      } catch (error) {
        await this.prisma.jobRun.update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            message: error instanceof Error ? error.message : String(error),
            finishedAt: new Date(),
          },
        });
        this.logger.error(`scheduler vote_close failed for vote ${vote.id}`);
      }
    }
  }

  /** Manual trigger (administrators) — respects the same idempotency guard. */
  async trigger(jobType: SchedulerJobType, period?: string): Promise<void> {
    if (jobType === 'vote_close') {
      await this.voteClose();
      return;
    }
    const resolvedPeriod =
      jobType === 'invoice_run' || jobType === 'recurring_gen' || jobType === 'late_fee'
        ? (period ?? this.previousMonthKey())
        : null;
    await this.runForAllBuildings(jobType, resolvedPeriod, async (buildingId, user) => {
      switch (jobType) {
        case 'invoice_run':
          return this.invoices.run(buildingId, { periodYearMonth: resolvedPeriod! }, user);
        case 'recurring_gen':
          return this.recurring.generate(buildingId, resolvedPeriod!, user);
        case 'late_fee':
          return this.lateFees.run(buildingId, { month: resolvedPeriod! }, user);
        case 'reminders':
          return this.reminders.send(buildingId, undefined, user);
        case 'maintenance_jobs':
          return this.maintenance.generateDueJobs(buildingId, user);
        case 'compliance_check':
          return this.compliance.checkExpiries(buildingId, user);
        default:
          return null;
      }
    });
  }

  async history(limit = 50): Promise<JobRunView[]> {
    const rows = await this.prisma.jobRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      buildingId: row.buildingId,
      jobType: row.jobType as SchedulerJobType,
      period: row.period,
      status: row.status,
      message: row.message,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    }));
  }
}

function safeMessage(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  if (typeof result === 'string') return result.slice(0, 400);
  try {
    return JSON.stringify(result).slice(0, 400);
  } catch {
    return null;
  }
}