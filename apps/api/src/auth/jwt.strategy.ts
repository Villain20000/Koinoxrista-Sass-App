import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  ACCESS_TOKEN_TTL,
  AccessTokenPayload,
  AuthenticatedUser,
  JWT_ACCESS_SECRET,
} from './auth.types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Validates access tokens (type === 'access') and maps them to the
 * `AuthenticatedUser` shape attached to `req.user`.
 *
 * The current User row is always loaded from the DB so `role` and the
 * *active* `buildingId` reflect live state (e.g. after a building switch),
 * never stale token claims.
 *
 * Implemented without passport (not a dependency of this workspace); it is
 * consumed by {@link JwtAuthGuard}.
 */
@Injectable()
export class JwtStrategy {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedUser> {
    const token = this.extractBearerToken(authorizationHeader);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.validate(payload);
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload?.type !== 'access' || !payload.sub) {
      throw new UnauthorizedException('Invalid token type');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      buildingId: user.buildingId ?? null,
    };
  }

  private extractBearerToken(
    authorizationHeader: string | undefined,
  ): string | undefined {
    if (!authorizationHeader) return undefined;
    const [scheme, token] = authorizationHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return undefined;
    return token;
  }
}

export const JWT_STRATEGY_ACCESS_OPTIONS = {
  secret: JWT_ACCESS_SECRET,
  expiresIn: ACCESS_TOKEN_TTL,
} as const;
