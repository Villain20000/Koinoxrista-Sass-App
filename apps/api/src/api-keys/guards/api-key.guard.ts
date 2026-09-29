import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeyRateLimiter } from '../api-key-rate-limiter';
import {
  API_KEY_SCOPE_KEY,
  HttpRequestWithApiKey,
} from '../decorators/current-api-key.decorator';

const PREMIUM_TIERS = new Set(['PREMIUM']);
const BILLABLE_STATUSES = new Set(['ACTIVE', 'TRIALING']);

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly rateLimiter: ApiKeyRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestWithApiKey>();

    const raw = request.headers['x-api-key'];
    if (!raw) throw new UnauthorizedException('API key required');

    const key = await this.prisma.apiKey.findUnique({
      where: { keyHash: sha256Hex(raw) },
      include: {
        building: { include: { subscription: true } },
      },
    });
    if (!key || key.revokedAt) {
      throw new UnauthorizedException('Invalid API key');
    }

    const requiredScope = this.reflector.getAllAndOverride<string | undefined>(
      API_KEY_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredScope && !key.scopes.includes(requiredScope)) {
      throw new ForbiddenException(`Missing scope: ${requiredScope}`);
    }

    const subscription = key.building.subscription;
    if (
      !subscription ||
      !PREMIUM_TIERS.has(subscription.tier) ||
      !BILLABLE_STATUSES.has(subscription.status)
    ) {
      throw new ForbiddenException('Premium subscription required');
    }

    const retryAfterSeconds = this.rateLimiter.hit(key.id);
    if (retryAfterSeconds > 0) {
      http.getResponse<{ setHeader(name: string, value: string): unknown }>()
        .setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: 429,
          message: 'Rate limit exceeded',
          error: 'Too Many Requests',
        },
        429,
      );
    }

    request.apiKey = {
      id: key.id,
      buildingId: key.buildingId,
      userId: key.userId,
      name: key.name,
      scopes: [...key.scopes],
    };

    void this.prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return true;
  }
}
