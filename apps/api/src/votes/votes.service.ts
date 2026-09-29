import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BallotView, VoteChoice, VoteOutcome, VoteTally } from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import {
  resolveOwnershipBasis,
  totalOwnershipWeight,
  unitOwnershipWeight,
} from '@org/shared';
import { assertSameBuilding } from '../common/tenant';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SmsContext } from '../notifications/sms-templates';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CastBallotDto } from './dto/cast-ballot.dto';
import { CreateVoteDto } from './dto/create-vote.dto';
import { tallyVote, TallyThresholdType } from './tally-vote';

export type DerivedVoteStatus = 'SCHEDULED' | 'OPEN' | 'CLOSED';

export interface VoteListItem {
  id: string;
  buildingId: string;
  topic: string;
  description: string | null;
  thresholdType: string;
  opensAt: string;
  closesAt: string;
  result: VoteOutcome | null;
  status: DerivedVoteStatus;
  ballotsCount: number;
}

export interface VoteDetail extends VoteListItem {
  myBallots: BallotView[];
  tally: VoteTally;
}

export interface VoteBallotRow {
  id: string;
  unitId: string;
  unitLabel: string;
  choice: VoteChoice;
}

const VOTE_WITH_COUNT = Prisma.validator<Prisma.VoteInclude>()({
  _count: { select: { ballots: true } },
});
type VoteRow = Prisma.VoteGetPayload<{ include: typeof VOTE_WITH_COUNT }>;

function derivedStatus(
  vote: Pick<VoteRow, 'opensAt' | 'closesAt' | 'result'>,
  now: Date,
): DerivedVoteStatus {
  if (vote.result !== null) return 'CLOSED';
  if (now < vote.opensAt) return 'SCHEDULED';
  if (now <= vote.closesAt) return 'OPEN';
  return 'CLOSED';
}

@Injectable()
export class VotesService {
  private readonly logger = new Logger(VotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(
    buildingId: string,
    dto: CreateVoteDto,
    user: AuthenticatedUser,
  ): Promise<VoteListItem> {
    assertSameBuilding(user, buildingId);

    const now = new Date();
    const opensAt = dto.opensAt ? new Date(dto.opensAt) : now;
    const closesAt = new Date(dto.closesAt);
    if (Number.isNaN(opensAt.getTime()) || Number.isNaN(closesAt.getTime())) {
      throw new BadRequestException('opensAt/closesAt must be valid ISO dates');
    }
    if (closesAt.getTime() <= now.getTime()) {
      throw new BadRequestException('closesAt must be in the future');
    }
    if (opensAt.getTime() >= closesAt.getTime()) {
      throw new BadRequestException('opensAt must be before closesAt');
    }

    const vote = await this.prisma.vote.create({
      data: {
        buildingId,
        topic: dto.topic,
        description: dto.description,
        thresholdType: dto.thresholdType,
        opensAt,
        closesAt,
      },
      include: VOTE_WITH_COUNT,
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'vote.created',
      entity: 'vote',
      entityId: vote.id,
      metadata: { topic: dto.topic },
    });

    void this.notifyOwners(buildingId, {
      type: 'vote.opened',
      title: `Νέα ψηφοφορία: ${dto.topic}`,
      linkPath: '/votes',
      sms: { kind: 'vote.opened', topic: dto.topic, periodKey: vote.id },
    });

    return this.toListItem(vote, now);
  }

  async list(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<VoteListItem[]> {
    assertSameBuilding(user, buildingId);

    const votes = await this.prisma.vote.findMany({
      where: { buildingId },
      include: VOTE_WITH_COUNT,
      orderBy: { closesAt: 'asc' },
    });
    const now = new Date();

    return votes.map((vote) => this.toListItem(vote, now));
  }

  async get(voteId: string, user: AuthenticatedUser): Promise<VoteDetail> {
    const vote = await this.prisma.vote.findUnique({
      where: { id: voteId },
      include: VOTE_WITH_COUNT,
    });
    if (!vote) throw new NotFoundException('Vote not found');
    assertSameBuilding(user, vote.buildingId);

    const [ownedUnits, ballots] = await Promise.all([
      this.ownedUnits(user.id, vote.buildingId),
      this.prisma.ballot.findMany({ where: { voteId } }),
    ]);
    const ownedUnitIds = new Set(ownedUnits.map((o) => o.unitId));
    const now = new Date();

    const tally = await this.computeTally(
      vote.thresholdType,
      vote.buildingId,
      ballots,
    );
    const status = derivedStatus(vote, now);
    if (status !== 'CLOSED') {
      tally.outcome = 'PENDING';
    }

    return {
      ...this.toListItem(vote, now),
      myBallots: this.myBallotViews(ballots, ownedUnitIds),
      tally,
    };
  }

  async castBallot(
    voteId: string,
    dto: CastBallotDto,
    user: AuthenticatedUser,
  ): Promise<BallotView[]> {
    const vote = await this.prisma.vote.findUnique({ where: { id: voteId } });
    if (!vote) throw new NotFoundException('Vote not found');
    assertSameBuilding(user, vote.buildingId);

    const now = new Date();
    if (
      vote.result !== null ||
      now < vote.opensAt ||
      now > vote.closesAt
    ) {
      throw new BadRequestException('Voting is not open for this vote');
    }

    const ownedUnits = await this.ownedUnits(user.id, vote.buildingId);
    if (ownedUnits.length === 0) {
      throw new ForbiddenException(
        'You must own at least one unit in this building to vote',
      );
    }

    const saved = await Promise.all(
      ownedUnits.map((ownership) =>
        this.prisma.ballot.upsert({
          where: {
            voteId_unitId: { voteId, unitId: ownership.unitId },
          },
          update: { choice: dto.choice },
          create: { voteId, unitId: ownership.unitId, choice: dto.choice },
        }),
      ),
    );

    this.audit.record({
      buildingId: vote.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'vote.ballot',
      entity: 'ballot',
      entityId: voteId,
      metadata: { choice: dto.choice, units: saved.length },
    });

    // NOTE: the Ballot model carries no timestamp column; votedAt stays blank.
    const ballotsView = saved.map((ballot) => ({
      id: ballot.id,
      choice: ballot.choice as VoteChoice,
      votedAt: '',
    }));

    // Live tally push so open vote pages refresh without polling.
    void this.pushTally(vote.id, vote.buildingId);

    return ballotsView;
  }

  /** Recompute and broadcast the tally to every connected member. */
  private async pushTally(voteId: string, buildingId: string): Promise<void> {
    try {
      const vote = await this.prisma.vote.findUnique({
        where: { id: voteId },
        include: VOTE_WITH_COUNT,
      });
      if (!vote) return;
      const ballots = await this.prisma.ballot.findMany({
        where: { voteId },
      });
      const tally = await this.computeTally(
        vote.thresholdType,
        buildingId,
        ballots,
      );
      this.realtime.publishToBuilding(buildingId, 'vote.updated', {
        voteId,
        ballotsCount: ballots.length,
        tally,
      });
    } catch (err: unknown) {
      // Realtime is best-effort; a tally push must never break ballot casting.
      this.logger.warn(`vote tally push failed: ${String(err)}`);
    }
  }

  async close(
    voteId: string,
    user: AuthenticatedUser,
  ): Promise<VoteDetail> {
    const vote = await this.prisma.vote.findUnique({
      where: { id: voteId },
      include: VOTE_WITH_COUNT,
    });
    if (!vote) throw new NotFoundException('Vote not found');
    assertSameBuilding(user, vote.buildingId);

    const now = new Date();
    if (vote.result !== null) {
      const stored = JSON.parse(vote.result) as VoteTally;
      return {
        ...this.toListItem(vote, now),
        myBallots: [],
        tally: stored,
      };
    }

    const ballots = await this.prisma.ballot.findMany({
      where: { voteId },
    });
    const tally = await this.computeTally(
      vote.thresholdType,
      vote.buildingId,
      ballots,
    );

    const updated = await this.prisma.vote.update({
      where: { id: voteId },
      data: {
        result: JSON.stringify(tally),
        closesAt: new Date(Math.min(now.getTime(), vote.closesAt.getTime())),
      },
      include: VOTE_WITH_COUNT,
    });

    this.audit.record({
      buildingId: vote.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'vote.closed',
      entity: 'vote',
      entityId: voteId,
      metadata: { outcome: tally.outcome },
    });

    void this.notifyOwners(vote.buildingId, {
      type: 'vote.closed',
      title: 'Ολοκληρώθηκε η ψηφοφορία',
      linkPath: '/votes',
    });

    this.realtime.publishToBuilding(vote.buildingId, 'vote.closed', {
      voteId,
      outcome: tally.outcome,
      tally,
    });

    return {
      ...this.toListItem(updated, now),
      myBallots: [],
      tally,
    };
  }

  async listBallots(
    voteId: string,
    user: AuthenticatedUser,
  ): Promise<VoteBallotRow[]> {
    const vote = await this.prisma.vote.findUnique({ where: { id: voteId } });
    if (!vote) throw new NotFoundException('Vote not found');
    assertSameBuilding(user, vote.buildingId);

    const ballots = await this.prisma.ballot.findMany({
      where: { voteId },
      include: { unit: { select: { label: true } } },
      orderBy: { unitId: 'asc' },
    });

    return ballots.map((ballot) => ({
      id: ballot.id,
      unitId: ballot.unitId,
      unitLabel: ballot.unit.label,
      choice: ballot.choice as VoteChoice,
    }));
  }

  private async notifyOwners(
    buildingId: string,
    notification: {
      type: string;
      title: string;
      linkPath?: string;
      sms?: SmsContext;
    },
  ): Promise<void> {
    const owners = await this.prisma.ownership.findMany({
      where: { unit: { buildingId } },
      select: { userId: true },
      distinct: ['userId'],
    });
    await this.notifications.createForUsers(
      owners.map((owner) => owner.userId),
      notification,
    );
  }

  private toListItem(vote: VoteRow, now: Date): VoteListItem {
    let result: VoteOutcome | null = null;
    if (vote.result !== null) {
      result = (JSON.parse(vote.result) as VoteTally).outcome;
    }

    return {
      id: vote.id,
      buildingId: vote.buildingId,
      topic: vote.topic,
      description: vote.description,
      thresholdType: vote.thresholdType,
      opensAt: vote.opensAt.toISOString(),
      closesAt: vote.closesAt.toISOString(),
      result,
      status: derivedStatus(vote, now),
      ballotsCount: vote._count.ballots,
    };
  }

  private async ownedUnits(userId: string, buildingId: string) {
    return this.prisma.ownership.findMany({
      where: { userId, unit: { buildingId } },
      select: { unitId: true, unit: { select: { label: true } } },
    });
  }

  private myBallotViews(
    ballots: { id: string; unitId: string; choice: string }[],
    ownedUnitIds: Set<string>,
  ): BallotView[] {
    // NOTE: no timestamp column on Ballot; votedAt stays blank.
    return ballots
      .filter((ballot) => ownedUnitIds.has(ballot.unitId))
      .map((ballot) => ({
        id: ballot.id,
        choice: ballot.choice as VoteChoice,
        votedAt: '',
      }));
  }

  private async computeTally(
    thresholdType: string,
    buildingId: string,
    ballots: { unitId: string; choice: string }[],
  ): Promise<VoteTally> {
    const units = await this.prisma.unit.findMany({
      where: { buildingId },
      select: { id: true, millimes: true, squareMeters: true, shareFraction: true },
    });
    // P0-3: weight by ownership share / area when the building uses them,
    // falling back to millimes (Greek default). HEADCOUNT ignores ownership
    // weights entirely: every unit counts as one (per-unit equal weight).
    const isHeadcount = thresholdType === 'HEADCOUNT';
    const basis = isHeadcount ? 'MILLIMES' : resolveOwnershipBasis(units);
    const weightByUnit = new Map(
      units.map((u) => [u.id, isHeadcount ? 1 : unitOwnershipWeight(u, basis)]),
    );
    const totalWeight = isHeadcount
      ? units.length
      : totalOwnershipWeight(units, basis);

    return tallyVote(
      thresholdType as TallyThresholdType,
      ballots.map((b) => ({
        choice: b.choice as VoteChoice,
        millimes: weightByUnit.get(b.unitId) ?? 0,
      })),
      units.length,
      totalWeight,
    );
  }
}
