import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Role } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInviteDto } from './dto/create-invite.dto';

const DEFAULT_EXPIRY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Invites store only the SHA-256 hash; the raw token lives in the invite URL. */
export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function buildInviteUrl(rawToken: string): string {
  const appUrl = process.env.APP_URL ?? 'http://localhost:4200';
  return `${appUrl}/register?invite=${rawToken}`;
}

const INVITE_SELECT = {
  id: true,
  email: true,
  role: true,
  buildingId: true,
  unitId: true,
  expiresAt: true,
  acceptedAt: true,
  invitedById: true,
  createdAt: true,
  unit: { select: { label: true } },
} as const;

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    return this.prisma.invite.findMany({
      where: { buildingId },
      select: INVITE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    buildingId: string,
    dto: CreateInviteDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const email = dto.email.toLowerCase();

    let unitId: string | null = null;
    if (dto.role === Role.RESIDENT) {
      if (!dto.unitId) {
        throw new BadRequestException('unitId is required for RESIDENT invites');
      }
      const unit = await this.prisma.unit.findFirst({
        where: { id: dto.unitId, buildingId },
      });
      if (!unit) {
        throw new NotFoundException('Unit not found');
      }
      unitId = unit.id;
    }

    const pending = await this.prisma.invite.findFirst({
      where: {
        buildingId,
        email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pending) {
      throw new ConflictException(
        'An active invite already exists for this email',
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      const member =
        dto.role === Role.RESIDENT
          ? await this.prisma.ownership.findFirst({
              where: { userId: existingUser.id, unitId: unitId ?? undefined },
            })
          : await this.prisma.membership.findFirst({
              where: { userId: existingUser.id, buildingId },
            });
      if (member) {
        throw new ConflictException('User already belongs to this building');
      }
    }

    const rawToken = randomBytes(32).toString('hex');
    const expiresInDays = dto.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
    const invite = await this.prisma.invite.create({
      data: {
        email,
        role: dto.role,
        buildingId,
        unitId,
        tokenHash: hashInviteToken(rawToken),
        expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
        invitedById: user.id,
      },
      select: INVITE_SELECT,
    });

    return { ...invite, inviteUrl: buildInviteUrl(rawToken) };
  }

  async revoke(id: string, user: AuthenticatedUser): Promise<void> {
    const invite = await this.prisma.invite.findUnique({ where: { id } });
    if (!invite || invite.buildingId !== user.buildingId) {
      throw new NotFoundException('Invite not found');
    }
    await this.prisma.invite.delete({ where: { id } });
  }
}
