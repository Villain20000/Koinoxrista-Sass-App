import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PartnerLeadDto, PartnerSummaryDto } from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartnerLeadDto } from './dto/create-partner-lead.dto';
import { LeadStatusDto } from './dto/lead-status.dto';
import { UpdatePartnerLeadDto } from './dto/update-partner-lead.dto';
import {
  isLeadStatus,
  nextStatuses,
  validateStatusChange,
  type LeadStatus,
} from './pipeline';

/** Status values of the lead pipeline (mirrors the LateFeeMode export pattern). */
export type { LeadStatus } from './pipeline';

const PARTNER_CATEGORIES = ['INSURANCE', 'ELEVATOR', 'ENERGY', 'OTHER'];

/** Year window [Jan 1, next Jan 1) in UTC for `createdAt` filtering. */
function yearRange(year: number) {
  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    buildingId: string,
    user: AuthenticatedUser,
    query: { status?: string; category?: string } = {},
  ): Promise<PartnerLeadDto[]> {
    assertSameBuilding(user, buildingId);
    const status = this.parseStatus(query.status);
    const category = this.parseCategory(query.category);

    const leads = await this.prisma.partnerLead.findMany({
      where: {
        buildingId,
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return leads.map((lead) => toLeadDto(lead));
  }

  async create(
    buildingId: string,
    dto: CreatePartnerLeadDto,
    user: AuthenticatedUser,
  ): Promise<PartnerLeadDto> {
    assertSameBuilding(user, buildingId);

    const lead = await this.prisma.partnerLead.create({
      data: {
        buildingId,
        partnerName: dto.partnerName,
        category: dto.category,
        ...(dto.contactName !== undefined && dto.contactName !== ''
          ? { contactName: dto.contactName }
          : {}),
        ...(dto.contactEmail !== undefined && dto.contactEmail !== ''
          ? { contactEmail: dto.contactEmail }
          : {}),
        ...(dto.contactPhone !== undefined && dto.contactPhone !== ''
          ? { contactPhone: dto.contactPhone }
          : {}),
        expectedCommissionCents: dto.expectedCommissionCents,
        ...(dto.notes !== undefined && dto.notes !== ''
          ? { notes: dto.notes }
          : {}),
        createdById: user.id,
      },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'partner_lead.created',
      entity: 'partner_lead',
      entityId: lead.id,
      metadata: {
        partnerName: lead.partnerName,
        category: lead.category,
        expectedCommissionCents: lead.expectedCommissionCents,
      },
    });
    return toLeadDto(lead);
  }

  async update(
    id: string,
    dto: UpdatePartnerLeadDto,
    user: AuthenticatedUser,
  ): Promise<PartnerLeadDto> {
    const lead = await this.findOwned(user, id);

    const updated = await this.prisma.partnerLead.update({
      where: { id: lead.id },
      data: {
        ...(dto.partnerName !== undefined ? { partnerName: dto.partnerName } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.contactName !== undefined ? { contactName: dto.contactName } : {}),
        ...(dto.contactEmail !== undefined
          ? { contactEmail: dto.contactEmail }
          : {}),
        ...(dto.contactPhone !== undefined
          ? { contactPhone: dto.contactPhone }
          : {}),
        ...(dto.expectedCommissionCents !== undefined
          ? { expectedCommissionCents: dto.expectedCommissionCents }
          : {}),
        ...(dto.actualCommissionCents !== undefined
          ? { actualCommissionCents: dto.actualCommissionCents }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
    this.audit.record({
      buildingId: updated.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'partner_lead.updated',
      entity: 'partner_lead',
      entityId: updated.id,
      metadata: { partnerName: updated.partnerName, status: updated.status },
    });
    return toLeadDto(updated);
  }

  async changeStatus(
    id: string,
    dto: LeadStatusDto,
    user: AuthenticatedUser,
  ): Promise<PartnerLeadDto> {
    const lead = await this.findOwned(user, id);

    const result = validateStatusChange(
      lead.status,
      dto.status,
      dto.actualCommissionCents,
    );
    if (!result.ok) {
      throw new BadRequestException(result.message);
    }

    const updated = await this.prisma.partnerLead.update({
      where: { id: lead.id },
      data: {
        status: dto.status,
        ...(dto.actualCommissionCents !== undefined
          ? { actualCommissionCents: dto.actualCommissionCents }
          : {}),
      },
    });
    this.audit.record({
      buildingId: updated.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'partner_lead.status_changed',
      entity: 'partner_lead',
      entityId: updated.id,
      metadata: {
        from: lead.status,
        to: updated.status,
        partnerName: updated.partnerName,
        actualCommissionCents: updated.actualCommissionCents,
      },
    });
    return toLeadDto(updated);
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const lead = await this.findOwned(user, id);
    if (lead.status !== 'NEW') {
      throw new BadRequestException(
        'Only NEW leads can be deleted (pipeline history must be kept)',
      );
    }
    await this.prisma.partnerLead.delete({ where: { id: lead.id } });
    this.audit.record({
      buildingId: lead.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'partner_lead.deleted',
      entity: 'partner_lead',
      entityId: lead.id,
      metadata: { partnerName: lead.partnerName },
    });
  }

  /**
   * Won-commission rollup for `year` (defaults to the current UTC year).
   * WON leads are attributed to their creation month (`createdAt`); every WON
   * lead carries an `actualCommissionCents` value by pipeline invariant.
   */
  async summary(
    buildingId: string,
    user: AuthenticatedUser,
    year?: number,
  ): Promise<PartnerSummaryDto> {
    assertSameBuilding(user, buildingId);
    const resolvedYear = year ?? new Date().getUTCFullYear();

    const wonLeads = await this.prisma.partnerLead.findMany({
      where: {
        buildingId,
        status: 'WON',
        createdAt: yearRange(resolvedYear),
      },
      select: {
        category: true,
        actualCommissionCents: true,
        createdAt: true,
      },
    });

    let totalWonCents = 0;
    const categories = new Map<string, { wonCount: number; commissionCents: number }>();
    const months = new Map<string, number>();
    for (const lead of wonLeads) {
      const commission = lead.actualCommissionCents ?? 0;
      totalWonCents += commission;

      const bucket = categories.get(lead.category) ?? {
        wonCount: 0,
        commissionCents: 0,
      };
      bucket.wonCount += 1;
      bucket.commissionCents += commission;
      categories.set(lead.category, bucket);

      const month = lead.createdAt.toISOString().slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + commission);
    }

    return {
      byCategory: [...categories.entries()]
        .map(([category, agg]) => ({ category, ...agg }))
        .sort((a, b) => b.commissionCents - a.commissionCents),
      byMonth: [...months.entries()]
        .map(([month, cents]) => ({ month, commissionCents: cents }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      totalWonCents,
    };
  }

  /** Statuses the given lead may still move forward to (empty when terminal). */
  allowedNextStatuses(status: string): readonly LeadStatus[] {
    return isLeadStatus(status) ? nextStatuses(status) : [];
  }

  private parseStatus(status: string | undefined): LeadStatus | undefined {
    if (status === undefined || status === '') return undefined;
    if (!isLeadStatus(status)) {
      throw new BadRequestException('Invalid lead status');
    }
    return status;
  }

  private parseCategory(category: string | undefined): string | undefined {
    if (category === undefined || category === '') return undefined;
    if (!PARTNER_CATEGORIES.includes(category)) {
      throw new BadRequestException('Invalid partner category');
    }
    return category;
  }

  private findOwned(user: AuthenticatedUser, id: string) {
    if (!user.buildingId) {
      throw new ForbiddenException('User is not attached to a building');
    }
    return this.prisma.partnerLead
      .findFirst({ where: { id, buildingId: user.buildingId } })
      .then((lead) => {
        if (!lead) {
          throw new NotFoundException('Partner lead not found');
        }
        return lead;
      });
  }
}

export function toLeadDto(lead: {
  id: string;
  buildingId: string;
  partnerName: string;
  category: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  expectedCommissionCents: number;
  actualCommissionCents: number | null;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PartnerLeadDto {
  return {
    id: lead.id,
    buildingId: lead.buildingId,
    partnerName: lead.partnerName,
    category: lead.category,
    contactName: lead.contactName,
    contactEmail: lead.contactEmail,
    contactPhone: lead.contactPhone,
    expectedCommissionCents: lead.expectedCommissionCents,
    actualCommissionCents: lead.actualCommissionCents,
    status: lead.status,
    notes: lead.notes,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}
