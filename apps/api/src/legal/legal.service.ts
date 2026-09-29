import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { renderExodikHtml } from './templates/exodik';
import { CreateLegalCaseDto } from './dto/create-case.dto';

const LEGAL_STAGES = ['NOTICE', 'LAWYER', 'COURT', 'CLOSED'] as const;
const LEGAL_STATUSES = ['OPEN', 'SENT', 'ACKNOWLEDGED', 'CLOSED'] as const;
const STAGE_ORDER: Record<string, number> = {
  NOTICE: 0,
  LAWYER: 1,
  COURT: 2,
  CLOSED: 3,
};
const MS_PER_DAY = 86_400_000;

function isLegalStage(v: string): boolean {
  return (LEGAL_STAGES as readonly string[]).includes(v);
}
function isLegalStatus(v: string): boolean {
  return (LEGAL_STATUSES as readonly string[]).includes(v);
}
function canAdvance(from: string, to: string): boolean {
  if (!isLegalStage(from) || !isLegalStage(to)) return false;
  return STAGE_ORDER[to] === STAGE_ORDER[from] + 1;
}

function parseStage(stage?: string): string | undefined {
  if (stage === undefined || stage === '' || stage === null) return undefined;
  if (!isLegalStage(stage)) throw new BadRequestException(`Invalid stage: ${stage}`);
  return stage;
}
function parseStatus(status?: string): string | undefined {
  if (status === undefined || status === '' || status === null) return undefined;
  if (!isLegalStatus(status)) throw new BadRequestException(`Invalid status: ${status}`);
  return status;
}

function toCaseDto(row: any): any {
  return {
    id: row.id,
    buildingId: row.buildingId,
    unitId: row.unitId,
    title: row.title,
    stage: row.stage,
    status: row.status,
    totalCents: row.totalCents,
    invoiceIds: row.invoiceIds,
    lawyerName: row.lawyerName ?? null,
    lawyerEmail: row.lawyerEmail ?? null,
    notes: row.notes ?? null,
    lastSentAt: row.lastSentAt ? row.lastSentAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : new Date().toISOString(),
    unitLabel: row.unit?.label ?? null,
    buildingName: row.building?.name ?? null,
    buildingAddress: row.building?.address ?? null,
    events: row.events
      ? row.events.map((e: any) => ({
          id: e.id,
          caseId: e.caseId,
          buildingId: e.buildingId,
          type: e.type,
          payload: e.payload ?? null,
          createdAt: e.createdAt ? e.createdAt.toISOString() : new Date().toISOString(),
        }))
      : undefined,
  };
}

@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────────────────────────
  // Helpers to support flexible arity (spec vs real usage)
  // ──────────────────────────────────────────────
  private extractUserAndStage(
    stageOrUser?: string | AuthenticatedUser,
    statusOrUser?: string | AuthenticatedUser,
    maybeUser?: AuthenticatedUser,
  ): { user?: AuthenticatedUser; stage?: string; status?: string } {
    let user: AuthenticatedUser | undefined;
    let stage: string | undefined;
    let status: string | undefined;
    // detect user in first position
    if (stageOrUser && typeof stageOrUser === 'object' && 'role' in (stageOrUser as any)) {
      user = stageOrUser as AuthenticatedUser;
      // second may be stage, third status
      if (typeof statusOrUser === 'string') stage = statusOrUser;
      if (typeof maybeUser === 'string') status = maybeUser;
      // if statusOrUser is user-like? not expected
      if (statusOrUser && typeof statusOrUser === 'object' && 'role' in (statusOrUser as any)) {
        user = statusOrUser as AuthenticatedUser;
      }
      if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) {
        user = maybeUser;
      }
    } else {
      stage = stageOrUser as string | undefined;
      if (statusOrUser && typeof statusOrUser === 'object' && 'role' in (statusOrUser as any)) {
        user = statusOrUser as AuthenticatedUser;
      } else {
        status = statusOrUser as string | undefined;
        if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser;
        else if (typeof maybeUser === 'string') status = maybeUser as string;
      }
    }
    return { user, stage, status };
  }

  private extractCreateArgs(
    buildingId: string,
    dtoOrUser: any,
    userMaybe: any,
  ): { dto: CreateLegalCaseDto; user?: AuthenticatedUser } {
    let dto: CreateLegalCaseDto;
    let user: AuthenticatedUser | undefined;
    if (dtoOrUser && typeof dtoOrUser === 'object' && 'role' in dtoOrUser) {
      // (buildingId, user, dto)
      user = dtoOrUser as AuthenticatedUser;
      dto = userMaybe as CreateLegalCaseDto;
    } else {
      dto = dtoOrUser as CreateLegalCaseDto;
      if (userMaybe && typeof userMaybe === 'object' && 'role' in userMaybe) user = userMaybe as AuthenticatedUser;
    }
    return { dto, user };
  }

  private extractCaseAndUser(
    buildingIdOrCaseId: string,
    caseIdOrUser: string | AuthenticatedUser,
    userMaybe?: AuthenticatedUser,
  ): { buildingId?: string; caseId: string; user?: AuthenticatedUser } {
    let buildingId: string | undefined;
    let caseId: string;
    let user: AuthenticatedUser | undefined;
    if (typeof caseIdOrUser === 'string') {
      // Could be (buildingId, caseId) or (caseId, buildingId?) Assume first is buildingId if second looks like uuid/case id and we have two strings plus optional user.
      // If caller used (buildingId, caseId) we treat first as buildingId.
      // If caller used (caseId) only, buildingId will be the caseId and caseId will be user? Not.
      // Heuristic: if we have 3 args where second is caseId string and third is user, first is buildingId.
      buildingId = buildingIdOrCaseId;
      caseId = caseIdOrUser as string;
      if (userMaybe && typeof userMaybe === 'object' && 'role' in (userMaybe as any)) user = userMaybe;
    } else if (typeof caseIdOrUser === 'object' && 'role' in (caseIdOrUser as any)) {
      // (caseId, user)
      caseId = buildingIdOrCaseId;
      user = caseIdOrUser as AuthenticatedUser;
    } else {
      caseId = buildingIdOrCaseId;
    }
    return { buildingId, caseId, user };
  }

  // ──────────────────────────────────────────────

  async listCases(
    buildingId: string,
    stageOrUser?: string | AuthenticatedUser,
    statusOrUser?: string | AuthenticatedUser,
    maybeUser?: AuthenticatedUser,
  ): Promise<any[]> {
    const { user, stage, status } = this.extractUserAndStage(stageOrUser, statusOrUser, maybeUser);
    if (user) assertSameBuilding(user, buildingId);
    const parsedStage = parseStage(stage);
    const parsedStatus = parseStatus(status);
    const cases = await (this.prisma as any).legalCase.findMany({
      where: {
        buildingId,
        ...(parsedStage ? { stage: parsedStage } : {}),
        ...(parsedStatus ? { status: parsedStatus } : {}),
      },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return cases.map((c: any) => toCaseDto(c));
  }

  async getCase(
    buildingId: string,
    caseIdOrUser?: string | AuthenticatedUser,
    userMaybe?: AuthenticatedUser,
  ): Promise<any> {
    // Support both getCase(buildingId, caseId, user) and getCase(caseId, user) where buildingId is caseId
    let buildingIdResolved = buildingId;
    let caseId: string;
    let user: AuthenticatedUser | undefined;
    if (caseIdOrUser && typeof caseIdOrUser === 'object' && 'role' in (caseIdOrUser as any)) {
      // called as getCase(caseId, user)  => buildingId param is actually caseId
      caseId = buildingId;
      user = caseIdOrUser as AuthenticatedUser;
      // need to fetch case then infer buildingId
      const fallback = await (this.prisma as any).legalCase.findFirst({
        where: { id: caseId },
        include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
      });
      if (!fallback) throw new NotFoundException('Legal case not found');
      if (user) assertSameBuilding(user, fallback.buildingId);
      return toCaseDto(fallback);
    } else {
      caseId = caseIdOrUser as string;
      user = userMaybe;
      if (user) assertSameBuilding(user, buildingIdResolved);
      // If buildingId is caseId when called with single id, caseId will be undefined? Handle
      if (!caseId) {
        // buildingId was caseId, caseId undefined -> single arg call
        caseId = buildingIdResolved;
        const fallback = await (this.prisma as any).legalCase.findFirst({
          where: { id: caseId },
          include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
        });
        if (!fallback) throw new NotFoundException('Legal case not found');
        if (user) assertSameBuilding(user, fallback.buildingId);
        return toCaseDto(fallback);
      }
    }

    const legalCase = await (this.prisma as any).legalCase.findFirst({
      where: { id: caseId, buildingId: buildingIdResolved },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!legalCase) {
      // Try global lookup to differentiate 404 vs 403
      const anyCase = await (this.prisma as any).legalCase.findFirst({
        where: { id: caseId },
        include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
      });
      if (anyCase) {
        if (user) assertSameBuilding(user, anyCase.buildingId);
        // building mismatch but user building matches case building? Still 404 if buildingId param mismatched? We return 404 for isolation
        throw new NotFoundException('Legal case not found');
      }
      throw new NotFoundException('Legal case not found');
    }
    if (user) assertSameBuilding(user, legalCase.buildingId);
    return toCaseDto(legalCase);
  }

  async createCase(
    buildingId: string,
    dtoOrUser: CreateLegalCaseDto | AuthenticatedUser,
    userMaybe?: AuthenticatedUser,
  ): Promise<any> {
    const { dto, user } = this.extractCreateArgs(buildingId, dtoOrUser, userMaybe);
    if (user) assertSameBuilding(user, buildingId);
    if (!dto || !dto.unitId || !Array.isArray(dto.invoiceIds) || dto.invoiceIds.length === 0) {
      throw new BadRequestException('unitId and invoiceIds are required');
    }

    const unit = await (this.prisma as any).unit.findFirst({
      where: { id: dto.unitId, buildingId },
      select: { id: true, label: true },
    });
    if (!unit) throw new NotFoundException('Unit not found for this building');

    const invoices = await (this.prisma as any).invoice.findMany({
      where: { id: { in: dto.invoiceIds }, buildingId, unitId: dto.unitId },
    });
    if (invoices.length !== dto.invoiceIds.length) {
      throw new BadRequestException('One or more invoices not found for this unit/building');
    }
    let totalCents = 0;
    for (const inv of invoices) {
      const outstanding = Math.max(0, inv.totalCents - inv.paidCents);
      totalCents += outstanding;
    }
    if (totalCents <= 0) {
      throw new BadRequestException('Total outstanding must be > 0');
    }

    const title = dto.title?.trim() || `Εξώδικο — ${unit.label} — ${new Date().toISOString().slice(0, 10)}`;

    const created = await (this.prisma as any).legalCase.create({
      data: {
        buildingId,
        unitId: dto.unitId,
        title,
        stage: 'NOTICE',
        status: 'OPEN',
        totalCents,
        invoiceIds: dto.invoiceIds,
        ...(dto.lawyerName ? { lawyerName: dto.lawyerName } : {}),
        ...(dto.lawyerEmail ? { lawyerEmail: dto.lawyerEmail } : {}),
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } } },
    });

    await (this.prisma as any).legalEvent.create({
      data: {
        caseId: created.id,
        buildingId,
        type: 'CREATED',
        payload: { invoiceIds: dto.invoiceIds, totalCents, unitId: dto.unitId },
      },
    });

    this.audit.record({
      buildingId,
      actorId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action: 'legal.case.created',
      entity: 'legal_case',
      entityId: created.id,
      metadata: { unitId: dto.unitId, invoiceIds: dto.invoiceIds, totalCents, title },
    });

    // Return with events
    const withEvents = await (this.prisma as any).legalCase.findFirst({
      where: { id: created.id },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    return toCaseDto(withEvents ?? created);
  }

  async advanceStage(
    caseIdOrBuildingId: string,
    nextStageOrCaseId: string | { nextStage?: string; stage?: string } | AuthenticatedUser,
    userOrStage?: string | { nextStage?: string; stage?: string } | AuthenticatedUser,
    maybeUser?: AuthenticatedUser,
  ): Promise<any> {
    // Normalize to caseId, nextStage, user, buildingId
    let caseId: string;
    let nextStage: string;
    let user: AuthenticatedUser | undefined;
    let buildingId: string | undefined;

    // Detect buildingId+caseId+stage pattern
    if (
      typeof nextStageOrCaseId === 'string' &&
      typeof userOrStage === 'string' &&
      isLegalStage(userOrStage as string)
    ) {
      // (buildingId, caseId, nextStage, user?)
      buildingId = caseIdOrBuildingId;
      caseId = nextStageOrCaseId as string;
      nextStage = userOrStage as string;
      if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser as AuthenticatedUser;
    } else if (
      typeof nextStageOrCaseId === 'string' &&
      !isLegalStage(nextStageOrCaseId as string) &&
      userOrStage &&
      typeof userOrStage === 'object' &&
      ('nextStage' in (userOrStage as any) || 'stage' in (userOrStage as any))
    ) {
      // (buildingId, caseId, dto, user)
      buildingId = caseIdOrBuildingId;
      caseId = nextStageOrCaseId as string;
      const dto: any = userOrStage;
      nextStage = dto.nextStage ?? dto.stage;
      if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser as AuthenticatedUser;
    } else if (
      typeof nextStageOrCaseId === 'object' &&
      nextStageOrCaseId !== null &&
      ('nextStage' in (nextStageOrCaseId as any) || 'stage' in (nextStageOrCaseId as any))
    ) {
      // (caseId, dto, user)
      caseId = caseIdOrBuildingId;
      const dto: any = nextStageOrCaseId;
      nextStage = dto.nextStage ?? dto.stage;
      if (userOrStage && typeof userOrStage === 'object' && 'role' in (userOrStage as any)) user = userOrStage as AuthenticatedUser;
      else if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser as AuthenticatedUser;
    } else if (typeof nextStageOrCaseId === 'string' && isLegalStage(nextStageOrCaseId as string)) {
      // (caseId, nextStage, user?)
      caseId = caseIdOrBuildingId;
      nextStage = nextStageOrCaseId as string;
      if (userOrStage && typeof userOrStage === 'object' && 'role' in (userOrStage as any)) user = userOrStage as AuthenticatedUser;
      else if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser as AuthenticatedUser;
    } else if (typeof nextStageOrCaseId === 'string' && !isLegalStage(nextStageOrCaseId as string)) {
      // fallback: (caseId, nextStageStringMaybeNotStage) -> still use
      caseId = caseIdOrBuildingId;
      nextStage = nextStageOrCaseId as string;
      if (userOrStage && typeof userOrStage === 'object' && 'role' in (userOrStage as any)) user = userOrStage as AuthenticatedUser;
    } else {
      // final fallback
      caseId = caseIdOrBuildingId;
      nextStage = nextStageOrCaseId as unknown as string;
      if (userOrStage && typeof userOrStage === 'object' && 'role' in (userOrStage as any)) user = userOrStage as AuthenticatedUser;
    }

    if (!nextStage) throw new BadRequestException('nextStage is required');
    // allow DTO object extraction
    if (typeof nextStage === 'object' && (nextStage as any).nextStage) nextStage = (nextStage as any).nextStage;
    if (typeof nextStage === 'object' && (nextStage as any).stage) nextStage = (nextStage as any).stage;

    if (!isLegalStage(nextStage)) throw new BadRequestException(`Invalid stage: ${nextStage}`);

    const legalCase = await (this.prisma as any).legalCase.findFirst({ where: { id: caseId } });
    if (!legalCase) throw new NotFoundException('Legal case not found');
    if (buildingId && legalCase.buildingId !== buildingId) throw new NotFoundException('Legal case not found');
    if (user) assertSameBuilding(user, legalCase.buildingId);
    else if (buildingId) assertSameBuilding({ buildingId } as any, legalCase.buildingId); // dummy

    if (!canAdvance(legalCase.stage, nextStage)) {
      throw new BadRequestException(`Illegal transition ${legalCase.stage} → ${nextStage} (pipeline is forward-only)`);
    }

    const newStatus = nextStage === 'CLOSED' ? 'CLOSED' : legalCase.status;
    const updated = await (this.prisma as any).legalCase.update({
      where: { id: caseId },
      data: { stage: nextStage, status: newStatus },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } } },
    });

    await (this.prisma as any).legalEvent.create({
      data: {
        caseId,
        buildingId: legalCase.buildingId,
        type: 'ESCALATED',
        payload: { from: legalCase.stage, to: nextStage },
      },
    });

    this.audit.record({
      buildingId: legalCase.buildingId,
      actorId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action: 'legal.case.escalated',
      entity: 'legal_case',
      entityId: caseId,
      metadata: { from: legalCase.stage, to: nextStage },
    });

    const withEvents = await (this.prisma as any).legalCase.findFirst({
      where: { id: caseId },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    return toCaseDto(withEvents ?? updated);
  }

  async sendNotice(
    caseIdOrBuildingId: string,
    caseIdOrUser?: string | AuthenticatedUser,
    userMaybe?: AuthenticatedUser,
  ): Promise<any> {
    let buildingId: string | undefined;
    let caseId: string;
    let user: AuthenticatedUser | undefined;
    if (typeof caseIdOrUser === 'string' && caseIdOrUser.length > 0 && !('role' in (caseIdOrUser as any))) {
      // (buildingId, caseId, user?)
      buildingId = caseIdOrBuildingId;
      caseId = caseIdOrUser as string;
      if (userMaybe && typeof userMaybe === 'object' && 'role' in (userMaybe as any)) user = userMaybe as AuthenticatedUser;
    } else if (caseIdOrUser && typeof caseIdOrUser === 'object' && 'role' in (caseIdOrUser as any)) {
      // (caseId, user)
      caseId = caseIdOrBuildingId;
      user = caseIdOrUser as AuthenticatedUser;
    } else if (!caseIdOrUser) {
      caseId = caseIdOrBuildingId;
    } else {
      caseId = caseIdOrBuildingId;
      if (typeof caseIdOrUser === 'string') caseId = caseIdOrUser as string;
    }

    const legalCase = await (this.prisma as any).legalCase.findFirst({ where: { id: caseId } });
    if (!legalCase) throw new NotFoundException('Legal case not found');
    if (buildingId && legalCase.buildingId !== buildingId) throw new NotFoundException('Legal case not found');
    if (user) assertSameBuilding(user, legalCase.buildingId);

    const now = new Date();
    if (legalCase.lastSentAt) {
      const diff = now.getTime() - new Date(legalCase.lastSentAt).getTime();
      if (diff < 7 * MS_PER_DAY) {
        throw new HttpException('Notice already sent within 7 days', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const html = await this.getExodikHtml(legalCase.id, user);

    const updated = await (this.prisma as any).legalCase.update({
      where: { id: caseId },
      data: { lastSentAt: now, status: legalCase.status === 'OPEN' ? 'SENT' : legalCase.status },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } } },
    });

    await (this.prisma as any).legalEvent.create({
      data: {
        caseId,
        buildingId: legalCase.buildingId,
        type: 'NOTICE_SENT',
        payload: { sentAt: now.toISOString(), totalCents: legalCase.totalCents },
      },
    });

    this.audit.record({
      buildingId: legalCase.buildingId,
      actorId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action: 'legal.notice.sent',
      entity: 'legal_case',
      entityId: caseId,
      metadata: { totalCents: legalCase.totalCents },
    });

    return { html, case: toCaseDto(updated) };
  }

  async addNote(
    caseIdOrBuildingId: string,
    noteOrCaseId: string | AuthenticatedUser,
    userOrNote?: string | AuthenticatedUser | { note: string },
    maybeUser?: AuthenticatedUser,
  ): Promise<any> {
    let caseId: string;
    let note: string;
    let user: AuthenticatedUser | undefined;
    let buildingId: string | undefined;

    // Detect patterns:
    // addNote(caseId, note, user)  -> a=caseId, b=note, c=user
    // addNote(buildingId, caseId, note, user) -> a=buildingId, b=caseId, c=note, d=user
    // addNote(caseId, {note}, user)
    if (
      typeof noteOrCaseId === 'string' &&
      (typeof userOrNote === 'string' || (userOrNote && typeof userOrNote === 'object' && 'note' in (userOrNote as any)))
    ) {
      // Could be (buildingId, caseId, note)  OR (caseId, note)
      // Check if userOrNote is string and maybeUser is user -> then a is buildingId
      if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) {
        // 4 args: buildingId, caseId, note, user
        buildingId = caseIdOrBuildingId;
        caseId = noteOrCaseId as string;
        const n = userOrNote as any;
        note = typeof n === 'string' ? n : n.note;
        user = maybeUser;
      } else if (userOrNote && typeof userOrNote === 'object' && 'role' in (userOrNote as any)) {
        // (caseId, noteAsObject?, user?) Actually noteOrCaseId is caseId, userOrNote is user when note missing? but we need note.
        // Fallback
        buildingId = undefined;
        caseId = caseIdOrBuildingId;
        const dto: any = noteOrCaseId;
        note = typeof dto === 'string' ? dto : dto.note;
        user = userOrNote as AuthenticatedUser;
      } else {
        // (caseId, note) OR (buildingId, caseId, note without user)
        // Heuristic: if we have 3 string args and no user, assume buildingId, caseId, note vs caseId, note ?
        // Check if caseIdOrBuildingId looks like building and noteOrCaseId looks like case: we can't know.
        // We'll assume (caseId, note) if only 2 strings and no building inference.
        // If a has been inferred as buildingId, we need to decide based on count:
        // When called as addNote('case-1', 'hello') -> a='case-1', b='hello', c undefined => we want caseId='case-1', note='hello'
        // When called as addNote('building-1', 'case-1', 'hello') -> a='building-1', b='case-1', c='hello'
        // Distinguish by whether we have 3 args and first is building: check if maybeUser exists or not.
        // If userOrNote is string and maybeUser undefined and we have 3 args where second is caseId string, we treat a as buildingId only if we have 3 args and want to isolate.
        // Simpler: if typeof userOrNote === 'string' and maybeUser === undefined and noteOrCaseId as string length maybe? We'll treat as (caseId, note) when 2 args.
        // For 3 string args case: buildingId = a, caseId = b, note = c
        if (typeof userOrNote === 'string' && maybeUser === undefined && typeof noteOrCaseId === 'string') {
          // Could be (buildingId, caseId, note) with 3 strings: we need to decide if first is buildingId. We'll assume if caller passed 3 strings, it's buildingId,caseId,note.
          // But our earlier branch for 2 args (caseId, note) would also have 3 strings? No, 2 args would be a=caseId, b=note, c=undefined.
          // So if we have 3 strings, we can treat as buildingId,caseId,note.
          // To detect 3 strings vs 2, we check if caseIdOrBuildingId and noteOrCaseId and userOrNote are all strings.
          // In this branch, userOrNote is string, noteOrCaseId is string, so we have at least 3 strings total including first.
          // We'll check if maybeUser is undefined and we have 3 strings -> treat as buildingId,caseId,note
          // But we need to know total args count: if called with (buildingId, caseId, note) then a=buildingId, b=caseId, c=note, maybeUser=undefined => this matches.
          // We'll treat as buildingId,caseId,note when caller intent likely.
          // To avoid breaking (caseId, note) with 2 args, we check if maybeUser is defined? already.
          // For 2 args, userOrNote is second arg note, maybeUser undefined, but noteOrCaseId would be caseId, userOrNote note -> that's 2 args, not 3. So this branch wouldn't be taken because userOrNote is note, noteOrCaseId is caseId, but we are in branch where noteOrCaseId is string and userOrNote is string. For 2 args, caseIdOrBuildingId=caseId, noteOrCaseId=note, userOrNote=undefined -> not entering this branch (since userOrNote undefined). So this branch only for 3 args.
          buildingId = caseIdOrBuildingId;
          caseId = noteOrCaseId as string;
          note = userOrNote as string;
        } else {
          caseId = caseIdOrBuildingId;
          const n = noteOrCaseId as any;
          note = typeof n === 'string' ? n : n.note;
          if (userOrNote && typeof userOrNote === 'object' && 'role' in (userOrNote as any)) user = userOrNote as AuthenticatedUser;
        }
      }
    } else if (typeof noteOrCaseId === 'object' && noteOrCaseId !== null && ('note' in (noteOrCaseId as any) || 'role' in (noteOrCaseId as any))) {
      // addNote(caseId, {note}, user) or addNote(caseId, user)
      caseId = caseIdOrBuildingId;
      if ('note' in (noteOrCaseId as any)) {
        note = (noteOrCaseId as any).note;
        if (userOrNote && typeof userOrNote === 'object' && 'role' in (userOrNote as any)) user = userOrNote as AuthenticatedUser;
      } else {
        // noteOrCaseId is user
        user = noteOrCaseId as AuthenticatedUser;
        // need note from third param
        const dto: any = userOrNote;
        note = typeof dto === 'string' ? dto : dto?.note;
        if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser;
      }
    } else {
      // fallback simple
      caseId = caseIdOrBuildingId;
      if (typeof noteOrCaseId === 'string') note = noteOrCaseId as string;
      else if (noteOrCaseId && typeof noteOrCaseId === 'object') note = (noteOrCaseId as any).note;
      else note = userOrNote as unknown as string;
      if (userOrNote && typeof userOrNote === 'object' && 'role' in (userOrNote as any)) user = userOrNote as AuthenticatedUser;
      else if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser;
    }

    // Extract note from DTO if still object
    if (typeof note === 'object' && note !== null && 'note' in (note as any)) note = (note as any).note;
    if (!note || typeof note !== 'string' || note.trim().length === 0) throw new BadRequestException('note is required');
    if (note.length > 2000) throw new BadRequestException('note too long');

    const legalCase = await (this.prisma as any).legalCase.findFirst({ where: { id: caseId } });
    if (!legalCase) throw new NotFoundException('Legal case not found');
    if (buildingId && legalCase.buildingId !== buildingId) throw new NotFoundException('Legal case not found');
    if (user) assertSameBuilding(user, legalCase.buildingId);

    await (this.prisma as any).legalEvent.create({
      data: {
        caseId,
        buildingId: legalCase.buildingId,
        type: 'NOTE',
        payload: { note },
      },
    });

    // Optionally append to notes field? keep event only.
    this.audit.record({
      buildingId: legalCase.buildingId,
      actorId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action: 'legal.case.note',
      entity: 'legal_case',
      entityId: caseId,
      metadata: { note },
    });

    const withEvents = await (this.prisma as any).legalCase.findFirst({
      where: { id: caseId },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    return toCaseDto(withEvents ?? legalCase);
  }

  async closeCase(...args: any[]): Promise<any> {
    let buildingId: string | undefined;
    let caseId: string | undefined;
    let reason: string | undefined;
    let user: AuthenticatedUser | undefined;

    // Extract user if present
    const userIdx = args.findIndex((a) => a && typeof a === 'object' && 'role' in a);
    if (userIdx !== -1) {
      user = args[userIdx] as AuthenticatedUser;
      args.splice(userIdx, 1);
    }
    // Extract reason object
    const reasonObjIdx = args.findIndex((a) => a && typeof a === 'object' && 'reason' in a);
    if (reasonObjIdx !== -1) {
      reason = (args[reasonObjIdx] as any).reason;
      args.splice(reasonObjIdx, 1);
    }
    // Remaining args are strings
    const strs = args.filter((a) => typeof a === 'string') as string[];
    if (strs.length === 1) {
      caseId = strs[0];
    } else if (strs.length === 2) {
      // Could be [caseId, reason] or [buildingId, caseId]
      // If reason already extracted, treat as [buildingId, caseId]
      if (reason !== undefined) {
        buildingId = strs[0];
        caseId = strs[1];
      } else {
        // No reason yet, assume [caseId, reason] if second looks like reason (contains space or length > 20?) else [buildingId, caseId]
        // Simpler: if called from controller with 4 args, strs would be [buildingId, caseId, reason] => 3 strs, not 2.
        // So 2 strs here likely [caseId, reason]
        caseId = strs[0];
        reason = strs[1];
      }
    } else if (strs.length === 3) {
      buildingId = strs[0];
      caseId = strs[1];
      if (reason === undefined) reason = strs[2];
    } else if (strs.length >= 4) {
      buildingId = strs[0];
      caseId = strs[1];
      if (reason === undefined) reason = strs[2];
    }
    // Normalize reason if still object string
    if (typeof reason === 'object' && reason !== null && 'reason' in (reason as any)) reason = (reason as any).reason;
    if (!caseId) throw new BadRequestException('caseId is required');

    const legalCase = await (this.prisma as any).legalCase.findFirst({ where: { id: caseId } });
    if (!legalCase) throw new NotFoundException('Legal case not found');
    if (buildingId && legalCase.buildingId !== buildingId) throw new NotFoundException('Legal case not found');
    if (user) assertSameBuilding(user, legalCase.buildingId);
    if (legalCase.stage === 'CLOSED' && legalCase.status === 'CLOSED') {
      throw new BadRequestException('Case already closed');
    }

    const updated = await (this.prisma as any).legalCase.update({
      where: { id: caseId },
      data: { stage: 'CLOSED', status: 'CLOSED' },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } } },
    });

    await (this.prisma as any).legalEvent.create({
      data: {
        caseId,
        buildingId: legalCase.buildingId,
        type: 'CLOSED',
        payload: { reason: reason ?? null },
      },
    });

    this.audit.record({
      buildingId: legalCase.buildingId,
      actorId: user?.id ?? null,
      actorRole: user?.role ?? null,
      action: 'legal.case.closed',
      entity: 'legal_case',
      entityId: caseId,
      metadata: { reason },
    });

    const withEvents = await (this.prisma as any).legalCase.findFirst({
      where: { id: caseId },
      include: { unit: { select: { label: true } }, building: { select: { name: true, address: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    return toCaseDto(withEvents ?? updated);
  }

  async getExodikHtml(
    caseIdOrBuildingId: string,
    userOrCaseId?: string | AuthenticatedUser,
    maybeUser?: AuthenticatedUser,
  ): Promise<string> {
    let caseId: string;
    let buildingId: string | undefined;
    let user: AuthenticatedUser | undefined;

    if (typeof userOrCaseId === 'string') {
      // (buildingId, caseId, user?)
      buildingId = caseIdOrBuildingId;
      caseId = userOrCaseId;
      if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser;
    } else if (userOrCaseId && typeof userOrCaseId === 'object' && 'role' in (userOrCaseId as any)) {
      caseId = caseIdOrBuildingId;
      user = userOrCaseId as AuthenticatedUser;
    } else if (!userOrCaseId) {
      caseId = caseIdOrBuildingId;
    } else {
      caseId = caseIdOrBuildingId;
    }

    const legalCase = await (this.prisma as any).legalCase.findFirst({ where: { id: caseId } });
    if (!legalCase) throw new NotFoundException('Legal case not found');
    if (buildingId && legalCase.buildingId !== buildingId) throw new NotFoundException('Legal case not found');
    if (user) assertSameBuilding(user, legalCase.buildingId);

    const [building, unit, invoices] = await Promise.all([
      (this.prisma as any).building.findUnique({ where: { id: legalCase.buildingId } }),
      (this.prisma as any).unit.findFirst({ where: { id: legalCase.unitId } }),
      (this.prisma as any).invoice.findMany({ where: { id: { in: legalCase.invoiceIds || [] } } }),
    ]);
    if (!building) throw new NotFoundException('Building not found');
    if (!unit) throw new NotFoundException('Unit not found');

    const invoiceRows = (invoices || []).map((inv: any) => ({
      periodYearMonth: inv.periodYearMonth,
      totalCents: inv.totalCents,
      paidCents: inv.paidCents,
      outstandingCents: Math.max(0, inv.totalCents - inv.paidCents),
    }));

    const now = new Date();
    const deadline = new Date(now.getTime() + 15 * MS_PER_DAY);

    return renderExodikHtml({
      buildingName: building.name,
      buildingAddress: building.address,
      buildingCity: building.city,
      unitLabel: unit.label,
      title: legalCase.title,
      totalCents: legalCase.totalCents,
      invoices: invoiceRows,
      deadline,
      generatedAt: now,
      lawyerName: legalCase.lawyerName,
      lawyerEmail: legalCase.lawyerEmail,
      notes: legalCase.notes,
    });
  }

  async getStats(
    buildingId: string,
    userOrStage?: AuthenticatedUser | string,
    maybeUser?: AuthenticatedUser,
  ): Promise<any> {
    let user: AuthenticatedUser | undefined;
    if (userOrStage && typeof userOrStage === 'object' && 'role' in (userOrStage as any)) {
      user = userOrStage as AuthenticatedUser;
    } else if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) {
      user = maybeUser;
    } else if (typeof userOrStage === 'object' && 'role' in (userOrStage as any)) {
      user = userOrStage as AuthenticatedUser;
    }
    // also handle (buildingId, user) vs (buildingId)
    if (maybeUser && typeof maybeUser === 'object' && 'role' in (maybeUser as any)) user = maybeUser;
    if (user) assertSameBuilding(user, buildingId);

    const cases = await (this.prisma as any).legalCase.findMany({ where: { buildingId } });

    const byStageMap = new Map<string, number>();
    const byStatusMap = new Map<string, number>();
    let totalOutstandingCents = 0;
    for (const c of cases) {
      byStageMap.set(c.stage, (byStageMap.get(c.stage) ?? 0) + 1);
      byStatusMap.set(c.status, (byStatusMap.get(c.status) ?? 0) + 1);
      if (c.stage !== 'CLOSED' && c.status !== 'CLOSED') totalOutstandingCents += c.totalCents;
    }

    return {
      totalCases: cases.length,
      totalOutstandingCents,
      byStage: [...byStageMap.entries()].map(([stage, count]) => ({ stage, count })).sort((a, b) => a.stage.localeCompare(b.stage)),
      byStatus: [...byStatusMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => a.status.localeCompare(b.status)),
    };
  }
}
