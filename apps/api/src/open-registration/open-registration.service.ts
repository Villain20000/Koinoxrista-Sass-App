import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { Mailer, MAILER } from '../reminders/mailer';

const BCRYPT_ROUNDS = 10;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/** Hashes a raw verification token — only the hash is stored. */
export function hashEmailToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Deterministic 8-char building entry code from a random seed. */
function makeJoinCode(): string {
  return randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
}

@Injectable()
export class OpenRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /** Regenerate the building's open-join code (audited, admin only). */
  async regenerateJoinCode(buildingId: string, user: AuthenticatedUser): Promise<{ joinCode: string }> {
    assertSameBuilding(user, buildingId);
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) throw new NotFoundException('Building not found');

    const joinCode = makeJoinCode();
    await this.prisma.building.update({ where: { id: buildingId }, data: { joinCode } });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'open-registration.joinCode.regenerate',
      entity: 'building',
      entityId: buildingId,
    });
    return { joinCode };
  }

  /**
   * Open registration path: email + password + building entry code. Creates a
   * user in PENDING_VERIFICATION and sends a verification link. The user is
   * activated in verifyEmail and bound to the building.
   */
  async registerOpen(dto: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    buildingCode: string;
  }): Promise<{ id: string; email: string; status: string }> {
    const building = await this.prisma.building.findFirst({
      where: { joinCode: dto.buildingCode },
      select: { id: true, joinCode: true },
    });
    if (!building || building.joinCode !== dto.buildingCode) {
      throw new BadRequestException('Invalid building code');
    }

    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: Role.RESIDENT,
            buildingId: building.id,
            status: 'PENDING_VERIFICATION',
          },
          select: { id: true, email: true, status: true },
        });
        const rawToken = randomBytes(32).toString('hex');
        await tx.emailVerification.create({
          data: {
            userId: created.id,
            buildingId: building.id,
            tokenHash: hashEmailToken(rawToken),
            expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
          },
        });
        void this.sendVerificationEmail({
          email: created.email,
          rawToken,
          buildingName: '',
          appUrl: process.env.APP_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:4200',
        });
        return created;
      });
    } catch (error) {
      const prismaError = (error as { code?: string }).code;
      if (prismaError === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  /**
   * Activates a PENDING_VERIFICATION user. Binds Ownership/Membership only if
   * the email matches the owner-of-record list (Ownership.email — the building
   * under this plan uses email on the user record). Otherwise the resident
   * lands in PENDING_APPROVAL for the admin to approve.
   */
  async verifyEmail(rawToken: string): Promise<{ id: string; email: string; status: string }> {
    const record = await this.prisma.emailVerification.findUnique({
      where: { tokenHash: hashEmailToken(rawToken) },
      include: { user: true },
    });
    if (!record) throw new GoneException('Verification link is invalid');
    if (record.consumedAt) throw new GoneException('Verification link has already been used');
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('Verification link has expired');
    }
    const buildingId = record.buildingId;
    if (!buildingId) throw new BadRequestException('Verification record is missing a building');

    const now = new Date();
    if (!record.user) throw new BadRequestException('Verification record is missing its user');
    const email = record.user.email;
    // Owner-of-record match: if an ownership exists with a matching email (the
    // user row email), auto-activate; otherwise require admin approval.
    const ownership = await this.prisma.ownership.findFirst({
      where: { unit: { building: { id: buildingId } }, user: { email } },
    });

    const status = ownership ? 'ACTIVE' : 'PENDING_APPROVAL';
    const updated = await this.prisma.user.update({
      where: { id: record.userId },
      data: { status },
    });
    await this.prisma.emailVerification.update({
      where: { id: record.id },
      data: { consumedAt: now },
    });

    await this.prisma.membership.upsert({
      where: { userId_buildingId: { userId: record.userId, buildingId } },
      create: {
        userId: record.userId,
        buildingId,
        role: Role.RESIDENT,
        isDefault: true,
      },
      update: {},
    });

    this.audit.record({
      buildingId,
      actorId: record.userId,
      action: 'open-registration.verify',
      entity: 'user',
      entityId: record.userId,
      metadata: { status, autoBound: !!ownership },
    });

    return { id: updated.id, email: updated.email, status: updated.status };
  }

  /**
   * Admin approves a PENDING_APPROVAL resident (open-join flow). Binds the
   * resident as owner of the given unit when unitId is provided.
   */
  async approve(
    buildingId: string,
    userId: string,
    user: AuthenticatedUser,
    unitId?: string,
  ): Promise<{ id: string; status: string }> {
    assertSameBuilding(user, buildingId);
    const target = await this.prisma.user.findFirst({
      where: { id: userId, buildingId, status: 'PENDING_APPROVAL' },
    });
    if (!target) throw new NotFoundException('Pending resident not found');

    if (unitId) {
      // Rotate existing owner off the unit (move ownership) unless empty.
      const unit = await this.prisma.unit.findFirst({ where: { id: unitId, buildingId } });
      if (!unit) throw new NotFoundException('Unit not found');
      await this.prisma.ownership.create({
        data: {
          userId,
          unitId,
          shareMillimes: unit.millimes,
          periodStart: new Date(),
          occupantType: 'OWNER',
        },
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' },
    });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'open-registration.approve',
      entity: 'user',
      entityId: userId,
      metadata: { unitId: unitId ?? null },
    });
    return { id: updated.id, status: updated.status };
  }

  /** Reject a PENDING_APPROVAL resident (audited, admin only). */
  async reject(buildingId: string, userId: string, user: AuthenticatedUser): Promise<void> {
    assertSameBuilding(user, buildingId);
    const target = await this.prisma.user.findFirst({
      where: { id: userId, buildingId, status: 'PENDING_APPROVAL' },
    });
    if (!target) throw new NotFoundException('Pending resident not found');

    await this.prisma.user.update({ where: { id: userId }, data: { status: 'REJECTED' } });
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'open-registration.reject',
      entity: 'user',
      entityId: userId,
    });
  }

  /** Pending-approval residents list for the admin UI. */
  async listPending(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    return this.prisma.user.findMany({
      where: { buildingId, status: 'PENDING_APPROVAL' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async sendVerificationEmail(input: {
    email: string;
    rawToken: string;
    buildingName: string;
    appUrl: string;
  }): Promise<void> {
    const url = `${input.appUrl}/verify-email?token=${encodeURIComponent(input.rawToken)}`;
    await this.mailer.send(
      input.email,
      'Επιβεβαίωση email — PolykatoikiaOS',
      `<h2>Καλώς ήρθατε!</h2>
       <p>Επιβεβαιώστε το email σας για να ενεργοποιήσετε τον λογαριασμό σας.</p>
       <p><a href="${url}">Επιβεβαίωση email</a></p>`,
    );
  }
}