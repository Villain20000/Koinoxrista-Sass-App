import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { BidStatus, JobSource, JobStatus, WorkLogView } from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { CommissionsService } from '../marketplace/commission.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBidDto } from './dto/create-bid.dto';
import { CreateDefectDto } from './dto/create-defect.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateWorkLogDto } from './dto/create-work-log.dto';
import { RateBidDto } from './dto/rate-bid.dto';
import { UpsertProviderProfileDto } from './dto/provider-profile.dto';

export interface BidView {
  id: string;
  jobId: string;
  amountCents: number;
  message: string | null;
  status: BidStatus;
  ratingStars: number | null;
  providerName: string;
  providerTrade: string | null;
}

export interface JobAdminView {
  id: string;
  buildingId: string;
  title: string;
  description: string;
  status: JobStatus;
  source: JobSource;
  reporterName: string | null;
  budgetCents: number | null;
  workLogsCount: number;
  bidsCount: number;
  bids?: BidView[];
}

export interface JobMarketView {
  id: string;
  buildingName: string;
  title: string;
  description: string;
  status: JobStatus;
  budgetCents: number | null;
}

export interface JobBidListView {
  job: { id: string; title: string; status: JobStatus; buildingName: string };
  bid: BidView;
}

interface BidLike {
  id: string;
  jobId: string;
  amountCents: number;
  message: string | null;
  status: string;
  ratingStars: number | null;
  provider: {
    firstName: string;
    lastName: string;
    profile?: { trade: string } | null;
  };
}

const BID_WITH_PROVIDER = {
  provider: {
    select: {
      firstName: true,
      lastName: true,
      profile: { select: { trade: true } },
    },
  },
} satisfies Prisma.BidInclude;

function toBidView(bid: BidLike): BidView {
  return {
    id: bid.id,
    jobId: bid.jobId,
    amountCents: bid.amountCents,
    message: bid.message,
    status: bid.status as BidStatus,
    ratingStars: bid.ratingStars,
    providerName: [bid.provider.firstName, bid.provider.lastName]
      .filter(Boolean)
      .join(' '),
    providerTrade: bid.provider.profile?.trade ?? null,
  };
}

interface JobRowLike {
  id: string;
  buildingId: string;
  title: string;
  description: string;
  status: string;
  budgetCents: number | null;
  source?: string | null;
  reportedBy?: { firstName: string; lastName: string } | null;
  _count?: { workLogs: number; bids: number };
}

function reporterFullName(row: JobRowLike): string | null {
  if (!row.reportedBy) return null;
  return (
    [row.reportedBy.firstName, row.reportedBy.lastName]
      .filter(Boolean)
      .join(' ') || null
  );
}

function toJobAdminView(
  job: JobRowLike & { _count?: { workLogs: number; bids: number } },
): Omit<JobAdminView, 'bids'> {
  return {
    id: job.id,
    buildingId: job.buildingId,
    title: job.title,
    description: job.description,
    status: job.status as JobStatus,
    source: (job.source ?? 'ADMIN_RFP') as JobSource,
    reporterName: reporterFullName(job),
    budgetCents: job.budgetCents,
    workLogsCount: job._count?.workLogs ?? 0,
    bidsCount: job._count?.bids ?? 0,
  };
}

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly commissions: CommissionsService,
  ) {}

  async createJob(
    buildingId: string,
    dto: CreateJobDto,
    user: AuthenticatedUser,
  ): Promise<JobAdminView> {
    assertSameBuilding(user, buildingId);

    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
    });
    if (!building) throw new NotFoundException('Building not found');

    const job = await this.prisma.job.create({
      data: {
        buildingId,
        title: dto.title,
        description: dto.description,
        budgetCents: dto.budgetCents,
      },
    });

    return { ...toJobAdminView(job), bids: [] };
  }

  async createDefect(
    buildingId: string,
    dto: CreateDefectDto,
    user: AuthenticatedUser,
  ): Promise<JobAdminView> {
    assertSameBuilding(user, buildingId);
    if (user.role !== Role.RESIDENT && user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Only residents or admins can report defects',
      );
    }

    const job = await this.prisma.job.create({
      data: {
        buildingId,
        title: dto.title,
        description: dto.description,
        status: 'OPEN',
        source: 'RESIDENT_REPORT',
        reportedById: user.id,
      },
    });

    return { ...toJobAdminView(job), bids: [] };
  }

  async listForBuilding(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<JobAdminView[]> {
    assertSameBuilding(user, buildingId);
    const isAdmin = user.role === Role.ADMIN;

    const jobs = await this.prisma.job.findMany({
      where: {
        buildingId,
        ...(isAdmin
          ? {}
          : {
              OR: [
                { source: 'ADMIN_RFP' },
                { source: 'RESIDENT_REPORT', reportedById: user.id },
              ],
            }),
      },
      include: {
        _count: { select: { workLogs: true, bids: true } },
        bids: { include: BID_WITH_PROVIDER },
        ...(isAdmin
          ? { reportedBy: { select: { firstName: true, lastName: true } } }
          : {}),
      },
      orderBy: { id: 'desc' },
    });

    return jobs.map((job) => ({
      ...toJobAdminView(job),
      ...(isAdmin ? { bids: job.bids.map(toBidView) } : {}),
    }));
  }

  async marketplace(): Promise<JobMarketView[]> {
    const jobs = await this.prisma.job.findMany({
      where: { status: 'OPEN', source: { not: 'RESIDENT_REPORT' } },
      include: { building: { select: { name: true } } },
      orderBy: { id: 'desc' },
    });

    return jobs.map((job) => ({
      id: job.id,
      buildingName: job.building.name,
      title: job.title,
      description: job.description,
      status: job.status as JobStatus,
      budgetCents: job.budgetCents,
    }));
  }

  async myBids(userId: string): Promise<JobBidListView[]> {
    const bids = await this.prisma.bid.findMany({
      where: { providerUserId: userId },
      include: {
        ...BID_WITH_PROVIDER,
        job: { include: { building: { select: { name: true } } } },
      },
      orderBy: { id: 'desc' },
    });

    return bids.map((bid) => ({
      job: {
        id: bid.job.id,
        title: bid.job.title,
        status: bid.job.status as JobStatus,
        buildingName: bid.job.building.name,
      },
      bid: toBidView(bid),
    }));
  }

  async createBid(
    jobId: string,
    dto: CreateBidDto,
    user: AuthenticatedUser,
  ): Promise<BidView> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== 'OPEN') {
      throw new BadRequestException('Job is not open for bids');
    }

    const existing = await this.prisma.bid.findFirst({
      where: { jobId, providerUserId: user.id },
    });

    const saved = existing
      ? await this.prisma.bid.update({
          where: { id: existing.id },
          data: {
            amountCents: dto.amountCents,
            message: dto.message ?? null,
            status: 'SUBMITTED',
          },
          include: BID_WITH_PROVIDER,
        })
        : await this.prisma.bid.create({
            data: {
              jobId,
              providerUserId: user.id,
              amountCents: dto.amountCents,
              message: dto.message,
              status: 'SUBMITTED',
            },
            include: BID_WITH_PROVIDER,
          });

    void this.notifyBuildingAdmins(job.buildingId, {
      type: 'bid.received',
      title: 'Νέα προσφορά για εργασία',
      body: job.title,
      linkPath: '/jobs',
    });

    return toBidView(saved);
  }

  private async notifyBuildingAdmins(
    buildingId: string,
    notification: {
      type: string;
      title: string;
      body?: string;
      linkPath?: string;
    },
  ): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { role: Role.ADMIN, buildingId },
      select: { id: true },
    });
    await this.notifications.createForUsers(
      admins.map((admin) => admin.id),
      notification,
    );
  }

  async listBids(jobId: string, user: AuthenticatedUser): Promise<BidView[]> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    assertSameBuilding(user, job.buildingId);

    const bids = await this.prisma.bid.findMany({
      where: { jobId },
      include: BID_WITH_PROVIDER,
      orderBy: { amountCents: 'asc' },
    });

    return bids.map(toBidView);
  }

  async acceptBid(bidId: string, user: AuthenticatedUser): Promise<BidView> {
    const { view, providerUserId, award } = await this.prisma.$transaction(
      async (tx) => {
        const bid = await tx.bid.findUnique({
          where: { id: bidId },
          include: { job: true },
        });
        if (!bid) throw new NotFoundException('Bid not found');
        assertSameBuilding(user, bid.job.buildingId);
        if (bid.status !== 'SUBMITTED') {
          throw new BadRequestException('Only submitted bids can be accepted');
        }
        if (bid.job.status !== 'OPEN') {
          throw new BadRequestException('Job is not open for awarding');
        }

        await tx.bid.updateMany({
          where: { jobId: bid.jobId, id: { not: bidId }, status: 'SUBMITTED' },
          data: { status: 'REJECTED' },
        });
        const accepted = await tx.bid.update({
          where: { id: bidId },
          data: { status: 'ACCEPTED' },
          include: BID_WITH_PROVIDER,
        });
        await tx.job.update({
          where: { id: bid.jobId },
          data: { status: 'AWARDED' },
        });

        return {
          view: toBidView(accepted),
          providerUserId: accepted.providerUserId,
          award: {
            buildingId: bid.job.buildingId,
            jobId: bid.jobId,
            baseCents: accepted.amountCents,
          },
        };
      },
    );

    void this.notifications.create({
      userId: providerUserId,
      type: 'bid.accepted',
      title: 'Η προσφορά σας έγινε αποδεκτή',
      linkPath: '/jobs',
    });

    // Marketplace monetization: persist the platform commission for the
    // awarded job AFTER the award commits. Failures are logged, never fatal —
    // the award must not roll back because billing bookkeeping failed.
    void this.commissions
      .createForAward({
        buildingId: award.buildingId,
        jobId: award.jobId,
        providerId: providerUserId,
        baseCents: award.baseCents,
      })
      .catch((error: unknown) => {
        console.warn(
          '[marketplace] commission creation failed after award:',
          error,
        );
      });

    return view;
  }

  async rejectBid(bidId: string, user: AuthenticatedUser): Promise<BidView> {
    const bid = await this.prisma.bid.findUnique({
      where: { id: bidId },
      include: { job: true },
    });
    if (!bid) throw new NotFoundException('Bid not found');
    assertSameBuilding(user, bid.job.buildingId);
    if (bid.status !== 'SUBMITTED') {
      throw new BadRequestException('Only submitted bids can be rejected');
    }

    const updated = await this.prisma.bid.update({
      where: { id: bidId },
      data: { status: 'REJECTED' },
      include: BID_WITH_PROVIDER,
    });

    return toBidView(updated);
  }

  async addWorkLog(
    jobId: string,
    dto: CreateWorkLogDto,
    user: AuthenticatedUser,
  ): Promise<WorkLogView> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    const awarded = await this.prisma.bid.findFirst({
      where: { jobId, providerUserId: user.id, status: 'ACCEPTED' },
    });
    if (!awarded) {
      throw new ForbiddenException(
        'Only the awarded provider can log work on this job',
      );
    }
    if (job.status !== 'AWARDED' && job.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Work logs are not allowed for ${job.status} jobs`,
      );
    }

    const log = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workLog.create({
        data: { jobId, providerUserId: user.id, note: dto.note },
      });
      if (job.status === 'AWARDED') {
        await tx.job.update({
          where: { id: jobId },
          data: { status: 'IN_PROGRESS' },
        });
      }
      return created;
    });

    void this.notifyBuildingAdmins(job.buildingId, {
      type: 'worklog.added',
      title: 'Νέο ημερολόγιο εργασίας',
      body: job.title,
      linkPath: '/jobs',
    });

    return {
      id: log.id,
      jobId: log.jobId,
      note: log.note,
      loggedAt: log.loggedAt.toISOString(),
    };
  }

  async listWorkLogs(
    jobId: string,
    user: AuthenticatedUser,
  ): Promise<WorkLogView[]> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');

    if (user.role === Role.PROVIDER) {
      const awarded = await this.prisma.bid.findFirst({
        where: { jobId, providerUserId: user.id, status: 'ACCEPTED' },
      });
      if (!awarded) {
        throw new ForbiddenException(
          'Only the awarded provider or building members can view work logs',
        );
      }
    } else {
      assertSameBuilding(user, job.buildingId);
    }

    const logs = await this.prisma.workLog.findMany({
      where: { jobId },
      orderBy: { loggedAt: 'desc' },
    });

    return logs.map((log) => ({
      id: log.id,
      jobId: log.jobId,
      note: log.note,
      loggedAt: log.loggedAt.toISOString(),
    }));
  }

  async completeJob(
    jobId: string,
    user: AuthenticatedUser,
  ): Promise<JobAdminView> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    assertSameBuilding(user, job.buildingId);
    if (job.status !== 'AWARDED' && job.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        'Only awarded or in-progress jobs can be completed',
      );
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: { status: 'COMPLETED' },
      include: {
        _count: { select: { workLogs: true, bids: true } },
        reportedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return toJobAdminView(updated);
  }

  async convertToRfp(
    jobId: string,
    user: AuthenticatedUser,
  ): Promise<JobAdminView> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    assertSameBuilding(user, job.buildingId);

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: job.source === 'RESIDENT_REPORT' ? { source: 'ADMIN_RFP' } : {},
      include: {
        _count: { select: { workLogs: true, bids: true } },
        reportedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return toJobAdminView(updated);
  }

  async rateAcceptedBid(
    jobId: string,
    dto: RateBidDto,
    user: AuthenticatedUser,
  ): Promise<{ bid: BidView; providerRating: number | null }> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    assertSameBuilding(user, job.buildingId);

    return this.prisma.$transaction(async (tx) => {
      const accepted = await tx.bid.findFirst({
        where: { jobId, status: 'ACCEPTED' },
        include: BID_WITH_PROVIDER,
      });
      if (!accepted) {
        throw new NotFoundException('No accepted bid to rate for this job');
      }

      const rated = await tx.bid.update({
        where: { id: accepted.id },
        data: { ratingStars: dto.stars },
        include: BID_WITH_PROVIDER,
      });

      const ratedBids = await tx.bid.findMany({
        where: {
          providerUserId: rated.providerUserId,
          ratingStars: { not: null },
        },
        select: { ratingStars: true },
      });
      const sum = ratedBids.reduce((acc, b) => acc + (b.ratingStars ?? 0), 0);
      const average =
        ratedBids.length > 0
          ? Math.round((sum / ratedBids.length) * 100) / 100
          : null;

      await tx.providerProfile.upsert({
        where: { userId: rated.providerUserId },
        update: { rating: average },
        create: {
          userId: rated.providerUserId,
          trade: '',
          certs: [],
          rating: average,
        },
      });

      return { bid: toBidView(rated), providerRating: average };
    });
  }

  async getProviderProfile(userId: string) {
    return this.prisma.providerProfile.findUnique({ where: { userId } });
  }

  async upsertProviderProfile(userId: string, dto: UpsertProviderProfileDto) {
    return this.prisma.providerProfile.upsert({
      where: { userId },
      update: { trade: dto.trade, certs: dto.certs },
      create: { userId, trade: dto.trade, certs: dto.certs },
    });
  }
}
