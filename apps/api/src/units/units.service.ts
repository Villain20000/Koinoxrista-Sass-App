import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { TOTAL_MILLIMES } from '@org/shared';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';

const UNITS_WITH_OWNERS = Prisma.validator<Prisma.UnitInclude>()({
  ownerships: {
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
    },
  },
});

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForBuilding(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    await this.requireBuilding(buildingId);
    return this.prisma.unit.findMany({
      where: { buildingId },
      include: UNITS_WITH_OWNERS,
      orderBy: [{ floor: 'asc' }, { label: 'asc' }],
    });
  }

  async create(
    buildingId: string,
    dto: CreateUnitDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    await this.assertMillimesWithinLimit(buildingId, dto.millimes);

    return this.prisma.unit.create({
      data: {
        buildingId,
        label: dto.label,
        floor: dto.floor,
        millimes: dto.millimes,
        radiatorCount: dto.radiatorCount ?? 0,
        squareMeters: dto.squareMeters,
        shareFraction: dto.shareFraction,
      },
    });
  }

  async update(
    buildingId: string,
    unitId: string,
    dto: UpdateUnitDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit || unit.buildingId !== buildingId) {
      throw new NotFoundException('Unit not found');
    }

    const nextMillimes = dto.millimes ?? unit.millimes;
    if (nextMillimes !== unit.millimes) {
      await this.assertMillimesWithinLimit(buildingId, nextMillimes, unitId);
    }

    return this.prisma.unit.update({
      where: { id: unitId },
      data: {
        label: dto.label ?? unit.label,
        floor: dto.floor ?? unit.floor,
        millimes: nextMillimes,
        radiatorCount: dto.radiatorCount ?? unit.radiatorCount,
        squareMeters:
          dto.squareMeters !== undefined ? dto.squareMeters : unit.squareMeters,
        shareFraction:
          dto.shareFraction !== undefined ? dto.shareFraction : unit.shareFraction,
      },
    });
  }

  async remove(
    buildingId: string,
    unitId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    assertSameBuilding(user, buildingId);
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      include: { _count: { select: { shares: true, invoices: true } } },
    });
    if (!unit || unit.buildingId !== buildingId) {
      throw new NotFoundException('Unit not found');
    }
    if (unit._count.shares > 0 || unit._count.invoices > 0) {
      throw new ConflictException(
        'Unit has shares or invoices and cannot be deleted',
      );
    }

    await this.prisma.unit.delete({ where: { id: unitId } });
  }

  private async assertMillimesWithinLimit(
    buildingId: string,
    additionalMillimes: number,
    excludeUnitId?: string,
  ): Promise<void> {
    const aggregate = await this.prisma.unit.aggregate({
      where: {
        buildingId,
        ...(excludeUnitId ? { id: { not: excludeUnitId } } : {}),
      },
      _sum: { millimes: true },
    });
    const currentTotal = aggregate._sum.millimes ?? 0;
    if (currentTotal + additionalMillimes > TOTAL_MILLIMES) {
      throw new BadRequestException(
        `Units would total ${currentTotal + additionalMillimes} millimes; current total is ${currentTotal} and the maximum is ${TOTAL_MILLIMES}`,
      );
    }
  }

  private async requireBuilding(buildingId: string): Promise<void> {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
    });
    if (!building) {
      throw new ForbiddenException('Building not found');
    }
  }
}
