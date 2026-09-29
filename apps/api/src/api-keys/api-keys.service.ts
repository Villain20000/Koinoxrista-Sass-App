import { createHash, randomBytes } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ApiKey, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import type {
  ApiKeyDto as ApiKeyView,
  CreatedApiKeyDto as CreatedApiKeyView,
} from '@org/shared';

const PREFIX_LENGTH = 8;
const SECRET_BYTES = 32; // → 43 base64url chars
// Underscore-free alphabet so `pk_<prefix>_<secret>` stays splittable by '_'.
const PREFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function generatePrefix(): string {
  const bytes = randomBytes(PREFIX_LENGTH);
  let prefix = '';
  for (let i = 0; i < PREFIX_LENGTH; i++) {
    prefix += PREFIX_ALPHABET[bytes[i] % PREFIX_ALPHABET.length];
  }
  return prefix;
}

function generateRawKey(): { raw: string; prefix: string } {
  const prefix = generatePrefix();
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { raw: `pk_${prefix}_${secret}`, prefix };
}

function toView(key: ApiKey): ApiKeyView {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    scopes: [...key.scopes],
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
  };
}

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    buildingId: string | null,
    userId: string,
    dto: CreateApiKeyDto,
  ): Promise<CreatedApiKeyView> {
    if (!buildingId) throw new ForbiddenException('No active building');
    const { raw, prefix } = generateRawKey();
    const key = await this.prisma.apiKey.create({
      data: {
        buildingId,
        userId,
        name: dto.name,
        prefix,
        keyHash: sha256Hex(raw),
        scopes: [...dto.scopes],
      },
    });
    return { ...toView(key), key: raw };
  }

  async list(buildingId: string | null): Promise<ApiKeyView[]> {
    if (!buildingId) throw new ForbiddenException('No active building');
    const keys = await this.prisma.apiKey.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(toView);
  }

  async revoke(buildingId: string | null, keyId: string): Promise<ApiKeyView> {
    if (!buildingId) throw new ForbiddenException('No active building');
    const where: Prisma.ApiKeyWhereUniqueInput = { id: keyId };
    const key = await this.prisma.apiKey.findFirst({
      where: { ...where, buildingId },
    });
    if (!key) throw new NotFoundException('API key not found');
    const revoked = await this.prisma.apiKey.update({
      where,
      data: { revokedAt: new Date() },
    });
    return toView(revoked);
  }
}
