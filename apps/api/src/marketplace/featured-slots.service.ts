import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { FeaturedSlotDto } from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeaturedSlotDto } from './dto/create-featured-slot.dto';

const SLOT_INCLUDE = {
  provider: { select: { firstName: true, lastName: true } },
} as const;

interface SlotRowLike {
  id: string;
  buildingId: string;
  providerId: string;
  trade: string | null;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  provider?: { firstName: string; lastName: string } | null;
}

function toDto(slot: SlotRowLike): FeaturedSlotDto {
  return {
    id: slot.id,
    buildingId: slot.buildingId,
    providerId: slot.providerId,
    trade: slot.trade ?? null,
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    createdAt: slot.createdAt.toISOString(),
    providerName: slot.provider
      ? [slot.provider.firstName, slot.provider.lastName]
          .filter(Boolean)
          .join(' ') || null
      : null,
  };
}

@Injectable()
export class FeaturedSlotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** All placements of the building, newest first. */
  async list(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<FeaturedSlotDto[]> {
    assertSameBuilding(user, buildingId);

    const slots = await this.prisma.featuredSlot.findMany({
      where: { buildingId },
      include: SLOT_INCLUDE,
      orderBy: { startsAt: 'desc' },
    });

    return slots.map(toDto);
  }

  /**
   * Creates a placement. Windows must be well-formed and must not overlap an
   * existing window of the SAME provider in the same building (409).
   */
  async create(
    buildingId: string,
    dto: CreateFeaturedSlotDto,
    user: AuthenticatedUser,
  ): Promise<FeaturedSlotDto> {
    assertSameBuilding(user, buildingId);

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      startsAt.getTime() >= endsAt.getTime()
    ) {
      throw new BadRequestException(
        'endsAt must be a valid ISO datetime after startsAt',
      );
    }

    const provider = await this.prisma.user.findFirst({
      where: { id: dto.providerId, role: Role.PROVIDER },
      select: { id: true },
    });
    if (!provider) throw new NotFoundException('Provider not found');

    const overlapping = await this.prisma.featuredSlot.findFirst({
      where: {
        buildingId,
        providerId: dto.providerId,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new ConflictException(
        'The provider already has an overlapping featured slot in this building',
      );
    }

    const slot = await this.prisma.featuredSlot.create({
      data: {
        buildingId,
        providerId: dto.providerId,
        trade: dto.trade?.trim() ? dto.trade.trim() : null,
        startsAt,
        endsAt,
      },
      include: SLOT_INCLUDE,
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'featured-slot.create',
      entity: 'featured_slot',
      entityId: slot.id,
      metadata: {
        providerId: dto.providerId,
        trade: slot.trade,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      },
    });

    return toDto(slot);
  }

  /** Deletes a building-owned placement; audited. */
  async remove(
    buildingId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    assertSameBuilding(user, buildingId);

    const slot = await this.prisma.featuredSlot.findFirst({
      where: { id, buildingId },
      include: SLOT_INCLUDE,
    });
    if (!slot) throw new NotFoundException('Featured slot not found');

    await this.prisma.featuredSlot.delete({ where: { id: slot.id } });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'featured-slot.delete',
      entity: 'featured_slot',
      entityId: slot.id,
      metadata: {
        providerId: slot.providerId,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
      },
    });
  }
}
