import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AgendaItemDto,
  AttendanceDto,
  AttendanceStatsDto,
  PraktikoDecisionDto,
  PraktikoDto,
} from '@org/shared';
import type { VoteChoice, VoteOutcome, VoteTally } from '@org/shared';
import {
  resolveOwnershipBasis,
  totalOwnershipWeight,
  unitOwnershipWeight,
  type OwnershipWeightBasis,
} from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { tallyVote, TallyThresholdType } from '../votes/tally-vote';
import { quorumOf } from './quorum';
import { Inject } from '@nestjs/common';
import { LLM_PROVIDER, LlmProvider } from '../assistant/llm-provider';
import { AttendanceToggleDto } from './dto/attendance-toggle.dto';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { UpdateAgendaItemDto } from './dto/update-agenda-item.dto';

/** Minimal shape of an agenda row needed to derive the next position. */
export interface PositionedItem {
  position: number;
}

export interface AttendanceStatUnit {
  id: string;
  millimes: number;
  squareMeters?: number | null;
  shareFraction?: number | null;
}

export interface AttendanceStatRow {
  unitId: string;
  present: boolean;
}

export interface DecisionAgendaRow {
  id: string;
  title: string;
}

export interface PraktikoInput {
  building: { id: string; name: string; address: string; city: string };
  vote: {
    id: string;
    topic: string;
    description: string | null;
    thresholdType: TallyThresholdType;
    opensAt: Date | string;
    closesAt: Date | string;
  };
  agendaItems: {
    id: string;
    position: number;
    title: string;
    body: string | null;
  }[];
  stats: AttendanceStatsDto;
  tally: VoteTally;
  /** Whether the vote window has ended / result is stored. */
  closed: boolean;
  generatedAt: Date | string;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

/** Next free agenda position (1-based dense order) after existing rows (pure). */
export function nextPosition(items: PositionedItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.position), 0) + 1;
}

/**
 * Quorum snapshot over all units of a building and their attendance rows.
 * Proxy representation counts toward `present`: the REPRESENTED unit's
 * millimes are what count in the assembly (pure).
 */
export function buildAttendanceStats(
  thresholdType: TallyThresholdType,
  units: AttendanceStatUnit[],
  rows: AttendanceStatRow[],
): AttendanceStatsDto {
  const presentIds = new Set(
    rows
      .filter((r) => r.present && units.some((u) => u.id === r.unitId))
      .map((r) => r.unitId),
  );
  // P0-3: HEADCOUNT counts units as one each; otherwise weight by ownership
  // share / area when the building uses them (millimes Greek default).
  const isHeadcount = thresholdType === 'HEADCOUNT';
  const basis = isHeadcount ? 'MILLIMES' : resolveOwnershipBasis(units);
  const totalMillimes = isHeadcount
    ? units.length
    : totalOwnershipWeight(units, basis);
  const millimesPresent = units
    .filter((u) => presentIds.has(u.id))
    .reduce((sum, u) => sum + (isHeadcount ? 1 : unitOwnershipWeight(u, basis)), 0);

  const { quorumMet, presentPermille } = quorumOf(
    totalMillimes,
    millimesPresent,
    thresholdType,
  );

  return {
    unitsTotal: units.length,
    unitsPresent: presentIds.size,
    totalMillimes,
    millimesPresent,
    presentPermille,
    quorumMet,
  };
}

/**
 * Decisions section of the minutes. Ballots attach to the VOTE (one decision
 * per assembly), so every agenda item records the vote's tally; an assembly
 * without agenda items yields a single decision keyed to the vote topic.
 */
export function buildDecisions(
  agendaRows: DecisionAgendaRow[],
  voteTopic: string,
  tally: VoteTally,
  closed: boolean,
): PraktikoDecisionDto[] {
  const outcome: VoteOutcome = closed ? tally.outcome : 'PENDING';
  return (
    agendaRows.length > 0
      ? agendaRows.map((row) => ({ agendaItemId: row.id, title: row.title }))
      : [{ agendaItemId: null, title: voteTopic }]
  ).map((entry) => ({
    ...entry,
    outcome,
    yesCount: tally.yesCount,
    noCount: tally.noCount,
    abstainCount: tally.abstainCount,
    yesMillimes: tally.yesMillimes,
    noMillimes: tally.noMillimes,
  }));
}

/** Assembles the printable πρακτικό DTO from precomputed parts (pure). */
export function buildPraktiko(input: PraktikoInput): PraktikoDto {
  return {
    building: input.building,
    vote: {
      id: input.vote.id,
      topic: input.vote.topic,
      description: input.vote.description,
      thresholdType: input.vote.thresholdType,
      opensAt: toIso(input.vote.opensAt),
      closesAt: toIso(input.vote.closesAt),
      closed: input.closed,
    },
    agenda: input.agendaItems.map((item) => ({
      id: item.id,
      position: item.position,
      title: item.title,
      body: item.body,
    })),
    decisions: buildDecisions(
      input.agendaItems,
      input.vote.topic,
      input.tally,
      input.closed,
    ),
    attendance: input.stats,
    generatedAt: toIso(input.generatedAt),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

@Injectable()
export class AssemblyService {
  private readonly logger = new Logger(AssemblyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async listAgenda(
    voteId: string,
    user: AuthenticatedUser,
  ): Promise<AgendaItemDto[]> {
    const vote = await this.findVote(voteId, user);
    const items = await this.prisma.agendaItem.findMany({
      where: { voteId: vote.id },
      orderBy: { position: 'asc' },
    });
    return items.map((item) => this.toAgendaDto(item));
  }

  async appendAgendaItem(
    voteId: string,
    dto: CreateAgendaItemDto,
    user: AuthenticatedUser,
  ): Promise<AgendaItemDto> {
    const vote = await this.findVote(voteId, user);
    const aggregate = await this.prisma.agendaItem.aggregate({
      where: { voteId },
      _max: { position: true },
    });
    const position = nextPosition([
      { position: aggregate._max.position ?? 0 },
    ]);

    try {
      const item = await this.prisma.agendaItem.create({
        data: {
          voteId,
          buildingId: vote.buildingId,
          position,
          title: dto.title,
          ...(dto.body !== undefined ? { body: dto.body } : {}),
        },
      });

      this.audit.record({
        buildingId: vote.buildingId,
        actorId: user.id,
        actorRole: user.role,
        action: 'assembly.agenda.created',
        entity: 'agendaItem',
        entityId: item.id,
        metadata: { voteId, position, title: dto.title },
      });

      return this.toAgendaDto(item);
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException(
          'An agenda item already occupies that position',
        );
      }
      throw error;
    }
  }

  async updateAgendaItem(
    id: string,
    dto: UpdateAgendaItemDto,
    user: AuthenticatedUser,
  ): Promise<AgendaItemDto> {
    const item = await this.prisma.agendaItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Agenda item not found');
    assertSameBuilding(user, item.buildingId);

    try {
      const updated = await this.prisma.agendaItem.update({
        where: { id: item.id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.body !== undefined ? { body: dto.body } : {}),
          ...(dto.position !== undefined ? { position: dto.position } : {}),
        },
      });

      this.audit.record({
        buildingId: item.buildingId,
        actorId: user.id,
        actorRole: user.role,
        action: 'assembly.agenda.updated',
        entity: 'agendaItem',
        entityId: item.id,
        metadata: { voteId: item.voteId },
      });

      return this.toAgendaDto(updated);
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException(
          'An agenda item already occupies that position',
        );
      }
      throw error;
    }
  }

  async removeAgendaItem(
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const item = await this.prisma.agendaItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Agenda item not found');
    assertSameBuilding(user, item.buildingId);

    await this.prisma.agendaItem.delete({ where: { id: item.id } });

    this.audit.record({
      buildingId: item.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'assembly.agenda.deleted',
      entity: 'agendaItem',
      entityId: item.id,
      metadata: { voteId: item.voteId },
    });
  }

  async getAttendance(
    voteId: string,
    user: AuthenticatedUser,
  ): Promise<AttendanceDto[]> {
    const vote = await this.findVote(voteId, user);

    const [units, rows, ballots] = await Promise.all([
      this.prisma.unit.findMany({
        where: { buildingId: vote.buildingId },
        orderBy: { label: 'asc' },
      }),
      this.prisma.attendance.findMany({ where: { voteId } }),
      this.prisma.ballot.findMany({
        where: { voteId },
        select: { unitId: true, choice: true },
      }),
    ]);

    const rowByUnit = new Map(rows.map((row) => [row.unitId, row]));
    const choiceByUnit = new Map(ballots.map((b) => [b.unitId, b.choice]));
    const basis = resolveOwnershipBasis(units);

    return units.map((unit) => {
      const row = rowByUnit.get(unit.id);
      const choice = choiceByUnit.get(unit.id);
      return {
        id: row?.id ?? null,
        voteId,
        unitId: unit.id,
        unitLabel: unit.label,
        millimes: unitOwnershipWeight(unit, basis),
        present: row?.present ?? false,
        proxyUnitId: row?.proxyUnitId ?? null,
        checkedInAt: row?.checkedInAt ? row.checkedInAt.toISOString() : null,
        ballotChoice: (choice as VoteChoice | undefined) ?? null,
      };
    });
  }

  /** Recompute attendance stats and broadcast them to the building. */
  private async pushQuorum(voteId: string, buildingId: string): Promise<void> {
    try {
      const [units, rows] = await Promise.all([      this.prisma.unit.findMany({ where: { buildingId } }),
      this.prisma.attendance.findMany({ where: { voteId } }),
    ]);
      const presentIds = new Set(
        rows
          .filter((r) => r.present && units.some((u) => u.id === r.unitId))
          .map((r) => r.unitId),
      );
      const basis = resolveOwnershipBasis(units);
      const totalMillimes = totalOwnershipWeight(units, basis);
      const millimesPresent = units
        .filter((u) => presentIds.has(u.id))
        .reduce((sum, u) => sum + unitOwnershipWeight(u, basis), 0);
      const { quorumMet, presentPermille } = quorumOf(
        totalMillimes,
        millimesPresent,
        'MILLIMES_MAJORITY',
      );
      this.realtime.publishToBuilding(buildingId, 'assembly.attendance', {
        voteId,
        unitsTotal: units.length,
        unitsPresent: presentIds.size,
        totalMillimes,
        millimesPresent,
        presentPermille,
        quorumMet,
      });
    } catch (err: unknown) {
      // Realtime is best-effort; a quorum push must never break check-in.
      this.logger.warn(`assembly quorum push failed: ${String(err)}`);
    }
  }

  /**
   * Check-in / presence toggle. Idempotent: re-submitting the exact same
   * state returns the current row without writing or re-auditing. Marking a
   * unit present stamps `checkedInAt`; marking absent clears it.
   */
  async toggleAttendance(
    voteId: string,
    dto: AttendanceToggleDto,
    user: AuthenticatedUser,
  ): Promise<AttendanceDto> {
    const vote = await this.findVote(voteId, user);

    const unit = await this.prisma.unit.findFirst({
      where: { id: dto.unitId, buildingId: vote.buildingId },
    });
    if (!unit) throw new NotFoundException('Unit not found');

    // P0-3: resolve the building-wide weight basis so per-unit display weights
    // stay consistent (ownership share / area / millimes).
    const buildingUnits = await this.prisma.unit.findMany({
      where: { buildingId: vote.buildingId },
      select: {
        id: true,
        millimes: true,
        squareMeters: true,
        shareFraction: true,
      },
    });
    const basis = resolveOwnershipBasis(buildingUnits);

    const proxyUnitId = dto.proxyUnitId ?? null;
    if (proxyUnitId !== null) {
      if (proxyUnitId === dto.unitId) {
        throw new BadRequestException('A unit cannot be its own proxy');
      }
      const proxy = await this.prisma.unit.findFirst({
        where: { id: proxyUnitId, buildingId: vote.buildingId },
      });
      if (!proxy) throw new NotFoundException('Proxy unit not found');
    }

    const existing = await this.prisma.attendance.findUnique({
      where: { voteId_unitId: { voteId, unitId: dto.unitId } },
    });
    if (
      existing &&
      existing.present === dto.present &&
      (existing.proxyUnitId ?? null) === proxyUnitId
    ) {
      return this.toAttendanceDto(existing, unit, basis);
    }

    const checkedInAt = dto.present ? new Date() : null;
    const row = await this.prisma.attendance.upsert({
      where: { voteId_unitId: { voteId, unitId: dto.unitId } },
      update: { present: dto.present, proxyUnitId, checkedInAt },
      create: {
        voteId,
        unitId: dto.unitId,
        buildingId: vote.buildingId,
        present: dto.present,
        proxyUnitId,
        checkedInAt,
      },
    });

    this.audit.record({
      buildingId: vote.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'assembly.attendance',
      entity: 'attendance',
      entityId: row.id,
      metadata: {
        voteId,
        unitId: dto.unitId,
        present: dto.present,
        proxyUnitId,
      },
    });

    // Live quorum meter: everyone connected to the building gets the new
    // attendance count + derived quorum line without polling.
    void this.pushQuorum(voteId, vote.buildingId);

    return this.toAttendanceDto(row, unit, basis);
  }

  async getPraktiko(
    voteId: string,
    user: AuthenticatedUser,
  ): Promise<PraktikoDto> {
    const vote = await this.findVote(voteId, user);

    const now = new Date();
    const closed =
      vote.result !== null || now.getTime() > vote.closesAt.getTime();

    let tally: VoteTally;
    if (vote.result !== null) {
      tally = JSON.parse(vote.result) as VoteTally;
    } else {
      tally = await this.computeTally(vote);
      if (!closed) tally.outcome = 'PENDING';
    }

    const [agendaItems, units, attendance] = await Promise.all([
      this.prisma.agendaItem.findMany({
        where: { voteId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.unit.findMany({
        where: { buildingId: vote.buildingId },
        select: {
          id: true,
          millimes: true,
          squareMeters: true,
          shareFraction: true,
        },
      }),
      this.prisma.attendance.findMany({
        where: { voteId },
        select: { unitId: true, present: true },
      }),
    ]);
    const stats = buildAttendanceStats(
      vote.thresholdType as TallyThresholdType,
      units,
      attendance,
    );

    return buildPraktiko({
      building: {
        id: vote.building.id,
        name: vote.building.name,
        address: vote.building.address,
        city: vote.building.city,
      },
      vote: {
        id: vote.id,
        topic: vote.topic,
        description: vote.description,
        thresholdType: vote.thresholdType as TallyThresholdType,
        opensAt: vote.opensAt,
        closesAt: vote.closesAt,
      },
      agendaItems,
      stats,
      tally,
      closed,
      generatedAt: now,
    });
  }

  /**
   * Local AI draft of the formal minutes narrative. Uses structured facts only
   * (no hallucinated attendees); LLM verbalizes the precomputed `praktiko` DTO.
   * Falls back to a deterministic template when the local model is unavailable.
   */
  async draftPraktiko(
    voteId: string,
    user: AuthenticatedUser,
  ): Promise<{ praktiko: PraktikoDto; draft: string; disclaimer: string }> {
    const praktiko = await this.getPraktiko(voteId, user);
    const facts = JSON.stringify(
      {
        building: praktiko.building,
        vote: praktiko.vote,
        agenda: praktiko.agenda,
        attendance: praktiko.attendance,
        decisions: praktiko.decisions,
      },
      null,
      2,
    );

    const system = [
      'You are a Greek building secretary drafting formal πρακτικό Γενικής Συνέλευσης.',
      'Write in formal Greek (katharevousa-light) using only the provided facts.',
      'Include: building header, date/time, agenda items in order, quorum line (present/total, ‰, quorumMet), and per-decision outcome (PASSED/REJECTED/PENDING) with millimes/headcount.',
      'Never invent attendees, proxy names, or amounts. If quorum not met, note it. End with disclaimer: "Αυτό το σχέδιο απαιτεί έγκριση από τη διαχείριση."',
    ].join('\n');

    const userPrompt = `Structured facts:\n${facts}\n\nGenerate the draft minutes.`;

    let draft: string;
    try {
      draft = await this.llm.complete(system, userPrompt);
    } catch {
      // Deterministic Greek template fallback (local-only, no LLM)
      const date = new Date(praktiko.vote.closesAt).toLocaleDateString('el-GR');
      const agendaText = praktiko.agenda.map((a) => `${a.position}. ${a.title}`).join('; ') || praktiko.vote.topic;
      const quorumLine = `Παρόντες ${praktiko.attendance.unitsPresent}/${praktiko.attendance.unitsTotal} (${praktiko.attendance.presentPermille}‰) — απαρτία ${praktiko.attendance.quorumMet ? 'επιτεύχθηκε' : 'δεν επιτεύχθηκε'}.`;
      const decisionsText = praktiko.decisions
        .map((d) => `${d.title}: ${d.outcome} (${d.yesMillimes ?? d.yesCount} υπέρ / ${d.noMillimes ?? d.noCount} κατά)`)
        .join(' | ');
      draft = `ΠΡΑΚΤΙΚΟ ΓΕΝΙΚΗΣ ΣΥΝΕΛΕΥΣΗΣ — ${praktiko.building.name}\nΘέμα: ${praktiko.vote.topic}\nΗμερομηνία: ${date}\nΑτζέντα: ${agendaText}\n${quorumLine}\nΑποφάσεις: ${decisionsText}\n`;
    }

    this.audit.record({
      buildingId: praktiko.building.id,
      actorId: user.id,
      actorRole: user.role,
      action: 'assembly.praktiko.draft',
      entity: 'vote',
      entityId: voteId,
      metadata: { via: this.llm.name },
    });

    return {
      praktiko,
      draft,
      disclaimer: 'Αυτό δεν αποτελεί νομική συμβουλή. Το σχέδιο απαιτεί έγκριση από τη διαχείριση.',
    };
  }

  private async findVote(voteId: string, user: AuthenticatedUser) {
    const vote = await this.prisma.vote.findUnique({
      where: { id: voteId },
      include: { building: true },
    });
    if (!vote) throw new NotFoundException('Vote not found');
    assertSameBuilding(user, vote.buildingId);
    return vote;
  }

  private async computeTally(vote: {
    id: string;
    buildingId: string;
    thresholdType: string;
  }): Promise<VoteTally> {
    const [units, ballots] = await Promise.all([
      this.prisma.unit.findMany({
        where: { buildingId: vote.buildingId },
        select: {
          id: true,
          millimes: true,
          squareMeters: true,
          shareFraction: true,
        },
      }),
      this.prisma.ballot.findMany({ where: { voteId: vote.id } }),
    ]);
    const isHeadcount = vote.thresholdType === 'HEADCOUNT';
    const basis = isHeadcount ? 'MILLIMES' : resolveOwnershipBasis(units);
    const weightByUnit = new Map(
      units.map((u) => [u.id, isHeadcount ? 1 : unitOwnershipWeight(u, basis)]),
    );

    return tallyVote(
      vote.thresholdType as TallyThresholdType,
      ballots.map((b) => ({
        choice: b.choice as VoteChoice,
        millimes: weightByUnit.get(b.unitId) ?? 0,
      })),
      units.length,
      isHeadcount ? units.length : totalOwnershipWeight(units, basis),
    );
  }

  private toAgendaDto(item: {
    id: string;
    voteId: string;
    position: number;
    title: string;
    body: string | null;
  }): AgendaItemDto {
    return {
      id: item.id,
      voteId: item.voteId,
      position: item.position,
      title: item.title,
      body: item.body,
    };
  }

  private toAttendanceDto(
    row: {
      id: string;
      voteId: string;
      unitId: string;
      present: boolean;
      proxyUnitId: string | null;
      checkedInAt: Date | null;
    },
    unit: { label: string; millimes: number; squareMeters?: number | null; shareFraction?: number | null },
    basis: OwnershipWeightBasis = 'MILLIMES',
  ): AttendanceDto {
    return {
      id: row.id,
      voteId: row.voteId,
      unitId: row.unitId,
      unitLabel: unit.label,
      millimes: unitOwnershipWeight(unit, basis),
      present: row.present,
      proxyUnitId: row.proxyUnitId,
      checkedInAt: row.checkedInAt ? row.checkedInAt.toISOString() : null,
    };
  }
}
