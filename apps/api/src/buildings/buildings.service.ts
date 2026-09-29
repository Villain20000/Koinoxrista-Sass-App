import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingSettingsDto } from './dto/update-building-settings.dto';

@Injectable()
export class BuildingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBuildingDto, user: AuthenticatedUser) {
    if (user.buildingId) {
      throw new ConflictException('User already manages a building');
    }

    return this.prisma.$transaction(async (tx) => {
      const building = await tx.building.create({
        data: {
          name: dto.name,
          address: dto.address ?? '',
          city: dto.city ?? 'Thessaloniki',
        },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { buildingId: building.id },
      });
      return building;
    });
  }

  /**
   * Update per-building settings — JP 適格請求書 registration number (Feature 19)
   * plus market/currency/PSP selection (P0-2 internationalisation). Empty string
   * clears the invoice number.
   */
  async updateSettings(
    buildingId: string,
    dto: UpdateBuildingSettingsDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!user.buildingId) {
      throw new ForbiddenException('User is not linked to a building');
    }

    return this.prisma.building.update({
      where: { id: buildingId },
      data: {
        ...(dto.invoiceRegistrationNo !== undefined
          ? { invoiceRegistrationNo: dto.invoiceRegistrationNo || null }
          : {}),
        ...(dto.market !== undefined ? { market: dto.market } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.pspProvider !== undefined ? { pspProvider: dto.pspProvider } : {}),
      },
    });
  }

  async findMine(user: AuthenticatedUser) {
    if (!user.buildingId) {
      throw new ForbiddenException('User is not linked to a building');
    }
    const building = await this.prisma.building.findUnique({
      where: { id: user.buildingId },
      include: { units: true },
    });
    if (!building) {
      throw new NotFoundException('Building not found');
    }
    return building;
  }
}
