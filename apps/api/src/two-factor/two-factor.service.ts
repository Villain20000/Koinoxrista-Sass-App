import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildOtpauthUri,
  generateSecret,
  verifyTotp,
} from './totp';

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10; // chars from the base32 alphabet

/**
 * The two User columns and the TwoFactorRecoveryCode delegate only exist in
 * the generated client after the integrator merges prisma/fragments/two-factor
 * and reruns `prisma generate`; these structural types keep the code compiling
 * both before and after that regeneration.
 */
interface TwoFactorUserFields {
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string | null;
}

interface RecoveryCodeRow {
  id: string;
  codeHash: string;
}

interface RecoveryCodeDelegate {
  create(args: {
    data: { userId: string; codeHash: string };
  }): Promise<RecoveryCodeRow>;
  findMany(args: {
    where: { userId: string; usedAt: null };
  }): Promise<RecoveryCodeRow[]>;
  updateMany(args: {
    where: { id: string; userId: string; usedAt: null };
    data: { usedAt: Date };
  }): Promise<{ count: number }>;
  deleteMany(args: { where: { userId: string } }): Promise<{ count: number }>;
}

export function twoFactorFields(user: User): TwoFactorUserFields {
  return user as unknown as TwoFactorUserFields;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Normalizes typed recovery codes: uppercase, separators stripped. */
function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let code = '';
  for (const byte of randomBytes(RECOVERY_CODE_LENGTH)) {
    code += alphabet[byte % alphabet.length];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private get recoveryCodes(): RecoveryCodeDelegate {
    // Appears on the delegate once `prisma generate` runs with the merged
    // fragment (see structural note above).
    return (
      this.prisma as unknown as { twoFactorRecoveryCode: RecoveryCodeDelegate }
    ).twoFactorRecoveryCode;
  }

  /** Cheap status probe used by GET /auth/me. */
  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    } as unknown as Prisma.UserFindUniqueArgs);
    if (!row) return false;
    return twoFactorFields(row as unknown as User).twoFactorEnabled === true;
  }

  /**
   * Generates a pending secret + otpauth URI. Nothing is persisted here; the
   * secret only becomes active once enable() verifies a live code.
   */
  setup(email: string): { secret: string; otpauthUri: string } {
    const secret = generateSecret();
    return { secret, otpauthUri: buildOtpauthUri({ email, secret }) };
  }

  /**
   * Verifies a first live token against the pending secret, enables 2FA and
   * (re)issues single-use recovery codes — returned in plaintext ONCE.
   */
  async enable(userId: string, secret: string, token: string): Promise<string[]> {
    if (!/^[A-Za-z2-7]+=*$/.test(secret)) {
      throw new BadRequestException('Invalid 2FA secret');
    }
    if (!verifyTotp(secret, token)) {
      throw new BadRequestException('Invalid verification code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: secret.toUpperCase(),
        twoFactorEnabled: true,
      } as unknown as Prisma.UserUpdateInput,
    });

    const plaintextCodes = Array.from(
      { length: RECOVERY_CODE_COUNT },
      generateRecoveryCode,
    );
    await this.recoveryCodes.deleteMany({ where: { userId } });
    for (const code of plaintextCodes) {
      await this.recoveryCodes.create({
        data: { userId, codeHash: sha256Hex(normalizeRecoveryCode(code)) },
      });
    }

    this.audit.record({
      actorId: userId,
      action: 'auth.2fa.enabled',
      entity: 'user',
      entityId: userId,
    });
    return plaintextCodes;
  }

  /** Disables 2FA after re-checking the current password; wipes codes+secret. */
  async disable(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid password');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: null,
        twoFactorEnabled: false,
      } as unknown as Prisma.UserUpdateInput,
    });
    await this.recoveryCodes.deleteMany({ where: { userId } });

    this.audit.record({
      actorId: userId,
      action: 'auth.2fa.disabled',
      entity: 'user',
      entityId: userId,
    });
  }

  /**
   * Second-step login check: accepts either a current TOTP code or an unused
   * recovery code (consumed atomically via a conditional updateMany).
   */
  async verifyLoginCode(user: User, token: string): Promise<boolean> {
    const { twoFactorSecret } = twoFactorFields(user);
    if (!twoFactorSecret) return false;

    if (verifyTotp(twoFactorSecret, token)) return true;

    const normalized = normalizeRecoveryCode(token);
    if (!/^[A-Z2-7]{10}$/.test(normalized)) return false;

    const hash = Buffer.from(sha256Hex(normalized), 'utf8');
    const candidates = await this.recoveryCodes.findMany({
      where: { userId: user.id, usedAt: null },
    });
    const match = candidates.find((row) => {
      const stored = Buffer.from(row.codeHash, 'utf8');
      return stored.length === hash.length && timingSafeEqual(stored, hash);
    });
    if (!match) return false;

    const consumed = await this.recoveryCodes.updateMany({
      where: { id: match.id, userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return consumed.count === 1;
  }
}
