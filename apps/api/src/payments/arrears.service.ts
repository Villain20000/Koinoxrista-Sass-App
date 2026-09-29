import { Injectable } from '@nestjs/common';
import type { ArrearsReport } from '@org/shared';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { buildArrears } from './build-arrears';

@Injectable()
export class ArrearsService {
  constructor(private readonly prisma: PrismaService) {}

  async getArrears(
    buildingId: string,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<ArrearsReport> {
    assertSameBuilding(user, buildingId);

    const [units, ownerships, invoices] = await Promise.all([
      this.prisma.unit.findMany({
        where: { buildingId },
        orderBy: { label: 'asc' },
      }),
      this.prisma.ownership.findMany({
        where: { unit: { buildingId } },
        select: {
          unitId: true,
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.invoice.findMany({ where: { buildingId } }),
    ]);

    return buildArrears(buildingId, units, ownerships, invoices, now);
  }
}
