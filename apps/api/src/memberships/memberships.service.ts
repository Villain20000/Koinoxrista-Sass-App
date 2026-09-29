import { ForbiddenException, Injectable } from '@nestjs/common';
import { Membership, Role, User } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface MembershipWithBuilding {
  id: string;
  role: Role;
  isDefault: boolean;
  building: {
    id: string;
    name: string;
    address: string;
    city: string;
    market: string;
    currency: string;
    pspProvider: string | null;
  };
}

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  listForUser(userId: string): Promise<MembershipWithBuilding[]> {
    return this.prisma.membership.findMany({
      where: { userId },
      orderBy: { building: { name: 'asc' } },
      select: {
        id: true,
        role: true,
        isDefault: true,
        building: {
          select: {
            id: true,
            name: true,
            address: true,
            city: true,
            market: true,
            currency: true,
            pspProvider: true,
          },
        },
      },
    });
  }

  async requireMembership(
    userId: string,
    buildingId: string,
  ): Promise<Membership> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_buildingId: { userId, buildingId } },
    });
    if (!membership) {
      throw new ForbiddenException('Not a member of this building');
    }
    return membership;
  }

  activateBuilding(userId: string, buildingId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { buildingId },
    });
  }
}
