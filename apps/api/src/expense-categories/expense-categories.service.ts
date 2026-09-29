import { Injectable, NotFoundException } from '@nestjs/common';
import { AllocationStrategy } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    buildingId: string,
    dto: CreateExpenseCategoryDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    await this.requireBuilding(buildingId);

    return this.prisma.expenseCategory.create({
      data: {
        buildingId,
        name: dto.name,
        strategy: dto.strategy ?? AllocationStrategy.MILIMES,
      },
    });
  }

  async list(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    await this.requireBuilding(buildingId);

    return this.prisma.expenseCategory.findMany({
      where: { buildingId },
      orderBy: { name: 'asc' },
    });
  }

  private async requireBuilding(buildingId: string): Promise<void> {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
    });
    if (!building) {
      throw new NotFoundException('Building not found');
    }
  }
}
