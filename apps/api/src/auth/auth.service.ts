import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Invite, Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import {
  ACCESS_TOKEN_TTL,
  AccessTokenPayload,
  JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET,
  RefreshTokenPayload,
  REFRESH_TOKEN_TTL,
} from './auth.types';
import {
  ChangeEmailDto,
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  TwoFactorLoginDto,
} from './dto/auth.dto';
import { LoginLockoutService } from '../security/login-lockout.service';
import { hashInviteToken } from '../invites/invites.service';
import {
  signLoginTicket,
  verifyLoginTicket,
} from '../two-factor/login-ticket';
import { TwoFactorService, twoFactorFields } from '../two-factor/two-factor.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SessionMeta,
  SessionsService,
} from '../sessions/sessions.service';

const BCRYPT_ROUNDS = 10;

// Public registration stays RESIDENT-only; ADMIN/PROVIDER accounts are
// provisioned through admin-sent invites (see InvitesService).
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly twoFactor: TwoFactorService,
    // Optional so legacy constructions (specs/tools) keep working without it.
    private readonly sessions?: SessionsService,
    private readonly lockout?: LoginLockoutService,
  ) {}

  async register(
    dto: RegisterDto,
  ): Promise<Pick<User, 'id' | 'email' | 'role'>> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const invite = dto.inviteToken
      ? await this.requireActiveInvite(dto.inviteToken)
      : null;
    try {
      if (!invite) {
        const user = await this.prisma.user.create({
          data: {
            email: dto.email.toLowerCase(),
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: Role.RESIDENT,
          },
        });
        return { id: user.id, email: user.email, role: user.role };
      }

      // Invited signup: role/building/membership are derived inside one
      // transaction so a failed side-effect cannot leave a half-provisioned user.
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: dto.email.toLowerCase(),
            passwordHash,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: invite.role,
            ...(invite.buildingId ? { buildingId: invite.buildingId } : {}),
          },
        });
        if (invite.role === Role.RESIDENT && invite.unitId) {
          const unit = await tx.unit.findUniqueOrThrow({
            where: { id: invite.unitId },
          });
          await tx.ownership.create({
            data: {
              unitId: invite.unitId,
              userId: created.id,
              shareMillimes: unit.millimes,
              periodStart: new Date(),
            },
          });
        } else if (invite.role === Role.ADMIN && invite.buildingId) {
          await tx.membership.create({
            data: {
              userId: created.id,
              buildingId: invite.buildingId,
              role: Role.ADMIN,
              isDefault: true,
            },
          });
        }
        await tx.invite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
        return created;
      });
      return { id: user.id, email: user.email, role: user.role };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  private async requireActiveInvite(rawToken: string): Promise<Invite> {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hashInviteToken(rawToken) },
    });
    if (!invite) {
      throw new BadRequestException('Invalid invite token');
    }
    if (invite.acceptedAt) {
      throw new BadRequestException('Invite has already been used');
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Invite has expired');
    }
    return invite;
  }

  async login(
    dto: LoginDto,
    sessionMeta?: SessionMeta,
  ): Promise<LoginResult> {
    const emailKey = dto.email.toLowerCase();
    // Feature 12: brute-force lockout before doing any work.
    this.lockout?.assertOpen(emailKey);

    const user = await this.prisma.user.findUnique({
      where: { email: emailKey },
    });
    if (!user) {
      await bcrypt.hash(dto.password, BCRYPT_ROUNDS); // constant-ish time
      this.lockout?.recordFailure(emailKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      this.lockout?.recordFailure(emailKey);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Correct password clears the failure counter.
    this.lockout?.reset(emailKey);

    // Correct password + 2FA enabled → do NOT issue tokens; hand out a
    // short-lived ticket that POST /auth/login/2fa redeems with a TOTP code.
    if (twoFactorFields(user).twoFactorEnabled === true) {
      this.logger.log(`User ${user.id} prompted for second factor`);
      return { twoFactorRequired: true, ticket: signLoginTicket(user.id) };
    }

    this.logger.log(`User ${user.id} logged in`);
    return this.issueTokens(user, sessionMeta);
  }

  /**
   * Second login step: redeems the 2FA ticket (signature + expiry checked
   * statelessly) together with a TOTP or unused recovery code and issues the
   * regular token pair.
   */
  async verifyTwoFactorLogin(dto: TwoFactorLoginDto): Promise<AuthTokens> {
    const userId = verifyLoginTicket(dto.ticket);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired 2FA ticket');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      twoFactorFields(user).twoFactorEnabled !== true ||
      !(await this.twoFactor.verifyLoginCode(user, dto.token))
    ) {
      throw new UnauthorizedException('Invalid verification code');
    }

    this.logger.log(`User ${user.id} logged in via 2FA`);
    return this.issueTokens(user);
  }

  async refresh(
    refreshToken: string | undefined,
    sessionMeta?: SessionMeta,
  ): Promise<AuthTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: JWT_REFRESH_SECRET },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // A user-revoked session must not refresh (untracked tokens fail open).
    if (this.sessions) {
      await this.sessions.assertNotRevoked(refreshToken);
    }
    const tokens = this.issueTokens(user, sessionMeta);
    this.sessions?.rotate(payload.sub, refreshToken, tokens.refreshToken);
    return tokens;
  }

  /** Signs access + refresh tokens for the given user row (login/refresh/switch-building). */
  issueTokens(user: User, sessionMeta?: SessionMeta): AuthTokens {
    const accessToken = this.signAccessToken(user);
    const refreshToken = this.signRefreshToken(user.id);
    this.sessions?.record(user.id, refreshToken, sessionMeta);
    return { accessToken, refreshToken };
  }

  /**
   * ACCOUNTANT seats have no Membership rows; their active building resolves
   * through explicit AccountantAccess grants instead (see accountant-seat).
   */
  async assertAccountantBuildingAccess(
    userId: string,
    buildingId: string,
  ): Promise<void> {
    const access = await this.prisma.accountantAccess.findUnique({
      where: { accountantId_buildingId: { accountantId: userId, buildingId } },
      select: { id: true },
    });
    if (!access) {
      throw new ForbiddenException('No accountant access to this building');
    }
  }

  /**
   * Feature 7: change password. Requires the current password, rehashes the
   * new one, and revokes every refresh session EXCEPT the one tied to the
   * current device (identified by `currentRefreshTokenHash` when provided).
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    currentRefreshTokenHash?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const newHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    this.prisma.refreshSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentRefreshTokenHash
          ? { tokenHash: { not: currentRefreshTokenHash } }
          : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  /** Feature 7: change email (re-authenticated + uniqueness enforced). */
  async changeEmail(userId: string, dto: ChangeEmailDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Password is incorrect');

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { email: dto.newEmail.toLowerCase() },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
  }

  private signAccessToken(user: User): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      type: 'access',
      email: user.email,
      role: user.role,
      buildingId: user.buildingId ?? null,
    };
    return this.jwtService.sign(payload, {
      secret: JWT_ACCESS_SECRET,
      expiresIn: ACCESS_TOKEN_TTL,
    });
  }

  private signRefreshToken(userId: string): string {
    const payload: RefreshTokenPayload = { sub: userId, type: 'refresh' };
    return this.jwtService.sign(payload, {
      secret: JWT_REFRESH_SECRET,
      expiresIn: REFRESH_TOKEN_TTL,
    });
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Token pair with an explicit "no 2FA" discriminant for the login union. */
export interface LoginTokens extends AuthTokens {
  twoFactorRequired?: false;
}

/** Returned instead of tokens when the password step succeeded but 2FA is on. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  ticket: string;
}

export type LoginResult = LoginTokens | TwoFactorChallenge;
