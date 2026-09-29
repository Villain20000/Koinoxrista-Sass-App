import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOwnershipDto } from './dto/create-ownership.dto';

@Injectable()
export class OwnershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    unitId: string,
    dto: CreateOwnershipDto,
    user: AuthenticatedUser,
  ) {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
    });
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }
    assertSameBuilding(user, unit.buildingId);

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }
    if (targetUser.buildingId && targetUser.buildingId !== unit.buildingId) {
      throw new ForbiddenException('User belongs to another building');
    }

    const aggregate = await this.prisma.ownership.aggregate({
      where: { unitId },
      _sum: { shareMillimes: true },
    });
    const allocated = aggregate._sum.shareMillimes ?? 0;
    if (allocated + dto.shareMillimes > unit.millimes) {
      throw new BadRequestException(
        `Ownership shares would total ${allocated + dto.shareMillimes} millimes but the unit only has ${unit.millimes}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (!targetUser.buildingId) {
        await tx.user.update({
          where: { id: targetUser.id },
          data: { buildingId: unit.buildingId },
        });
      }
      return tx.ownership.create({
        data: {
          unitId,
          userId: targetUser.id,
          shareMillimes: dto.shareMillimes,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
        },
      });
    });
  }

  async listForUnit(unitId: string, user: AuthenticatedUser) {
    const unit = await this.prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) {
      throw new NotFoundException('Unit not found');
    }
    assertSameBuilding(user, unit.buildingId);

    return this.prisma.ownership.findMany({
      where: { unitId },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });
  }
}
