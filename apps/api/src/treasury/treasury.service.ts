import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTreasuryAccountDto } from './dto/create-treasury-account.dto';
import { CreateTreasuryEntryDto } from './dto/create-treasury-entry.dto';

// These types mirror the Prisma models before `prisma generate` for treasury.
// Using string unions keeps the service independently type-safe.
type TreasuryAccountType = 'CASH' | 'BANK';
type TreasuryDirection = 'IN' | 'OUT';
type TreasuryMethod = 'CASH' | 'BANK' | 'CHECK' | 'CARD';

const ACCOUNT_TYPES: readonly string[] = ['CASH', 'BANK'];
const DIRECTIONS: readonly string[] = ['IN', 'OUT'];
const METHODS: readonly string[] = ['CASH', 'BANK', 'CHECK', 'CARD'];

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class TreasuryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  async listAccounts(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as unknown as Record<string, any>;
    return prismaAny.treasuryAccount.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createAccount(
    buildingId: string,
    dto: CreateTreasuryAccountDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!ACCOUNT_TYPES.includes(dto.type)) {
      throw new BadRequestException('type must be CASH or BANK');
    }
    if (
      dto.iban !== undefined &&
      dto.iban !== null &&
      dto.iban.trim() !== '' &&
      dto.type !== 'BANK'
    ) {
      // IBAN only makes sense for BANK accounts but allow it for CASH if provided
      // — silently keep it; or we could reject. We allow but warn via trimming.
    }
    const prismaAny = this.prisma as unknown as Record<string, any>;
    try {
      const account = await prismaAny.treasuryAccount.create({
        data: {
          buildingId,
          name: dto.name.trim(),
          type: dto.type,
          ...(dto.iban !== undefined && dto.iban.trim() !== ''
            ? { iban: dto.iban.trim() }
            : {}),
        },
      });
      this.audit.record({
        buildingId,
        actorId: user.id,
        actorRole: user.role,
        action: 'treasury.account.created',
        entity: 'treasury_account',
        entityId: account.id,
        metadata: { name: account.name, type: account.type },
      });
      return account;
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException('An account with this name already exists in the building');
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Entries
  // ---------------------------------------------------------------------------

  async listEntries(
    buildingId: string,
    user: AuthenticatedUser,
    filters: {
      accountId?: string;
      from?: string;
      to?: string;
      skip?: string | number;
      take?: string | number;
    } = {},
  ): Promise<{ items: any[]; total: number }> {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as unknown as Record<string, any>;

    const where: Record<string, unknown> = { buildingId };

    if (filters.accountId) {
      // Ensure account belongs to building for isolation check; if not found return empty
      const account = await prismaAny.treasuryAccount.findFirst({
        where: { id: filters.accountId, buildingId },
      });
      if (!account) {
        throw new NotFoundException('Treasury account not found');
      }
      (where as any).accountId = filters.accountId;
    }

    const createdAt: Record<string, Date> = {};
    if (filters.from) {
      const fromDate = new Date(filters.from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException('Invalid from date');
      }
      createdAt.gte = fromDate;
    }
    if (filters.to) {
      const toDate = new Date(filters.to);
      if (Number.isNaN(toDate.getTime())) {
        throw new BadRequestException('Invalid to date');
      }
      createdAt.lte = toDate;
    }
    if (Object.keys(createdAt).length > 0) {
      (where as any).createdAt = createdAt;
    }

    const take = Math.min(
      Math.max(Number(filters.take ?? DEFAULT_TAKE) || DEFAULT_TAKE, 1),
      MAX_TAKE,
    );
    const skip = Math.max(Number(filters.skip ?? 0) || 0, 0);

    const [items, total] = await (this.prisma as any).$transaction([
      prismaAny.treasuryEntry.findMany({
        where,
        include: { account: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prismaAny.treasuryEntry.count({ where }),
    ]);

    // Enrich with accountName for list views
    const enriched = items.map((e: any) => ({
      ...e,
      accountName: e.account?.name ?? null,
      createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
    }));

    return { items: enriched, total };
  }

  async createEntry(
    buildingId: string,
    dto: CreateTreasuryEntryDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);

    if (!DIRECTIONS.includes(dto.direction)) {
      throw new BadRequestException('direction must be IN or OUT');
    }
    if (!METHODS.includes(dto.method)) {
      throw new BadRequestException('method must be CASH, BANK, CHECK or CARD');
    }
    if (!Number.isInteger(dto.amountCents) || dto.amountCents === 0) {
      throw new BadRequestException('amountCents must be a non-zero integer (cents)');
    }
    if (dto.direction === 'IN' && dto.amountCents < 0) {
      throw new BadRequestException('IN entries must have positive amountCents');
    }
    if (dto.direction === 'OUT' && dto.amountCents > 0) {
      throw new BadRequestException('OUT entries must have negative amountCents');
    }

    const prismaAny = this.prisma as unknown as Record<string, any>;

    // Isolation: account must belong to the same building
    const account = await prismaAny.treasuryAccount.findFirst({
      where: { id: dto.accountId, buildingId },
    });
    if (!account) {
      throw new NotFoundException('Treasury account not found in this building');
    }

    // Atomic: create entry + update balance in a transaction
    const entry = await (this.prisma as any).$transaction(async (tx: Record<string, any>) => {
      const created = await tx.treasuryEntry.create({
        data: {
          accountId: dto.accountId,
          buildingId,
          amountCents: dto.amountCents,
          direction: dto.direction,
          method: dto.method,
          ...(dto.reference !== undefined && dto.reference.trim() !== ''
            ? { reference: dto.reference.trim() }
            : {}),
          ...(dto.notes !== undefined && dto.notes.trim() !== ''
            ? { notes: dto.notes.trim() }
            : {}),
          ...(dto.receiptUrl !== undefined && dto.receiptUrl.trim() !== ''
            ? { receiptUrl: dto.receiptUrl.trim() }
            : {}),
          ...(user.id ? { createdById: user.id } : {}),
        },
      });

      await tx.treasuryAccount.update({
        where: { id: dto.accountId },
        data: { balanceCents: { increment: dto.amountCents } },
      });

      return created;
    });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'treasury.entry.created',
      entity: 'treasury_entry',
      entityId: entry.id,
      metadata: {
        accountId: dto.accountId,
        amountCents: dto.amountCents,
        direction: dto.direction,
        method: dto.method,
      },
    });

    return entry;
  }

  // ---------------------------------------------------------------------------
  // Balance / KPIs
  // ---------------------------------------------------------------------------

  async getBalance(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    const prismaAny = this.prisma as unknown as Record<string, any>;

    const [accounts, entries] = await Promise.all([
      prismaAny.treasuryAccount.findMany({
        where: { buildingId },
        orderBy: { createdAt: 'asc' },
      }),
      prismaAny.treasuryEntry.findMany({
        where: { buildingId },
        select: { amountCents: true, direction: true, createdAt: true, accountId: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    let totalCents = 0;
    let cashCents = 0;
    let bankCents = 0;
    const byAccount = accounts.map((a: any) => {
      totalCents += a.balanceCents ?? 0;
      if (a.type === 'CASH') cashCents += a.balanceCents ?? 0;
      if (a.type === 'BANK') bankCents += a.balanceCents ?? 0;
      return {
        accountId: a.id,
        name: a.name,
        type: a.type as TreasuryAccountType,
        balanceCents: a.balanceCents ?? 0,
      };
    });

    // Monthly IN/OUT totals for chart (YYYY-MM ascending)
    const monthMap = new Map<string, { inCents: number; outCents: number }>();
    for (const e of entries as Array<{ amountCents: number; direction: string; createdAt: Date }>) {
      const d = e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt);
      const month = d.toISOString().slice(0, 7); // YYYY-MM
      const bucket = monthMap.get(month) ?? { inCents: 0, outCents: 0 };
      if (e.direction === 'IN' || e.amountCents > 0) {
        bucket.inCents += Math.abs(e.amountCents);
      } else {
        bucket.outCents += Math.abs(e.amountCents);
      }
      monthMap.set(month, bucket);
    }

    const byMonth = [...monthMap.entries()]
      .map(([month, v]) => ({
        month,
        inCents: v.inCents,
        outCents: v.outCents,
        netCents: v.inCents - v.outCents,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return {
      totalCents,
      cashCents,
      bankCents,
      byAccount,
      byMonth,
    };
  }
}
