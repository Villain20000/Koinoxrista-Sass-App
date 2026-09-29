import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BankConnection,
  ImportedTransaction,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import {
  SyncResultDto,
  BankConnectionDto,
  ImportedTransactionSuggestionDto,
} from '@org/shared/lib/openbanking';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import type { BankMatchConfidence } from '@org/shared';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BankConnectionRef,
  BankFeedAdapter,
  RawTx,
} from './openbanking.adapter';
import { BANK_FEED_ADAPTER, resolveOpenBankingMode } from './openbanking.adapter';
import {
  PendingBankPayment,
  suggestMatches,
} from '../bank-import/match-bank-payments';
import { CreateBankConnectionDto } from './dto/create-bank-connection.dto';

/** Default look-back window (days) for a connection's first sync. */
const FIRST_SYNC_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

function dayIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class OpenBankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(BANK_FEED_ADAPTER)
    private readonly adapter: BankFeedAdapter,
  ) {}

  async createConnection(
    buildingId: string,
    user: AuthenticatedUser,
    dto: CreateBankConnectionDto,
  ): Promise<BankConnectionDto> {
    assertSameBuilding(user, buildingId);
    const iban = normalizeIban(dto.iban);

    let created: BankConnection;
    try {
      created = await this.prisma.bankConnection.create({
        data: {
          buildingId,
          institutionName: dto.institutionName?.trim() || 'Τράπεζα',
          iban,
          mode: resolveOpenBankingMode(),
        },
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          'A connection for this IBAN already exists',
        );
      }
      throw error;
    }
    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'openbanking.connection.create',
      entity: 'bank-connection',
      entityId: created.id,
      metadata: { iban, mode: created.mode },
    });
    return this.toConnectionDto(created);
  }

  async listConnections(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<BankConnectionDto[]> {
    assertSameBuilding(user, buildingId);
    const rows = await this.prisma.bankConnection.findMany({
      where: { buildingId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toConnectionDto(row));
  }

  async deleteConnection(
    id: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const conn = await this.ownedConnection(id, user);
    await this.prisma.bankConnection.delete({ where: { id: conn.id } });
    this.audit.record({
      buildingId: conn.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'openbanking.connection.delete',
      entity: 'bank-connection',
      entityId: conn.id,
      metadata: { iban: conn.iban },
    });
  }

  /**
   * Idempotent feed sync: pulls raw transactions for the period since the
   * last sync (or the default look-back window), upserts them skipping
   * already-known externalIds, then feeds the bank-import match engine with
   * the positive credits to suggest pairings against unsettled payments.
   */
  async sync(id: string, user: AuthenticatedUser): Promise<SyncResultDto> {
    const conn = await this.ownedConnection(id, user);
    const toDate = dayIso(new Date());
    const fromDate =
      dayIso(conn.lastSyncedAt ?? new Date(Date.now() - FIRST_SYNC_WINDOW_DAYS * DAY_MS));

    const txs = await this.adapter.listTransactions(this.refOf(conn), fromDate, toDate);

    const known = await this.prisma.importedTransaction.findMany({
      where: { connectionId: conn.id },
      select: { externalId: true },
    });
    const knownIds = new Set(known.map((row) => row.externalId));

    let newCount = 0;
    for (const tx of txs) {
      await this.prisma.importedTransaction.upsert({
        where: {
          connectionId_externalId: {
            connectionId: conn.id,
            externalId: tx.externalId,
          },
        },
        create: this.txCreateData(conn, tx),
        update: {
          bookedAt: tx.bookedAt,
          amountCents: tx.amountCents,
          remittanceInfo: tx.remittanceInfo ?? null,
        },
      });
      if (!knownIds.has(tx.externalId)) newCount += 1;
    }

    const suggestions = suggestMatches(
      this.toParsedRows(txs),
      await this.findPendingPayments(conn.buildingId),
    );
    const counts = { high: 0, medium: 0, low: 0 };
    for (const suggestion of suggestions) counts[suggestion.confidence] += 1;

    await this.prisma.bankConnection.update({
      where: { id: conn.id },
      data: { lastSyncedAt: new Date() },
    });
    this.audit.record({
      buildingId: conn.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'openbanking.sync',
      entity: 'bank-connection',
      entityId: conn.id,
      metadata: { newCount, ...counts, fromDate, toDate },
    });

    return { newCount, ...counts };
  }

  async listTransactions(
    id: string,
    user: AuthenticatedUser,
  ): Promise<ImportedTransactionSuggestionDto[]> {
    const conn = await this.ownedConnection(id, user);
    const items = await this.prisma.importedTransaction.findMany({
      where: { connectionId: conn.id },
      orderBy: [{ bookedAt: 'desc' }, { id: 'asc' }],
    });

    // Annotate each credit with the confidence the match engine suggests
    // against the current pending payments (null when unmatched).
    const credits = items.filter((item) => item.amountCents > 0);
    const suggestions = suggestMatches(
      credits.map((item) => ({
        dateIso: dayIso(item.bookedAt),
        amountCents: item.amountCents,
        reference: item.remittanceInfo ?? '',
      })),
      await this.findPendingPayments(conn.buildingId),
    );
    const byExternalIndex = new Map<string, BankMatchConfidence>();
    suggestions.forEach((suggestion) => {
      const credit = credits[suggestion.rowIndex];
      if (credit) {
        byExternalIndex.set(credit.id, suggestion.confidence as BankMatchConfidence);
      }
    });

    return items.map((item) => ({
      ...this.toTransactionDto(item),
      suggestionConfidence: byExternalIndex.get(item.id) ?? null,
    }));
  }

  // -- helpers ---------------------------------------------------------------

  /** Tenant-safe lookup: unknown ids and other buildings both yield 404. */
  private async ownedConnection(
    id: string,
    user: AuthenticatedUser,
  ): Promise<BankConnection> {
    if (!user.buildingId) throw new NotFoundException('Unknown connection');
    const conn = await this.prisma.bankConnection.findFirst({
      where: { id, buildingId: user.buildingId },
    });
    if (!conn) throw new NotFoundException('Unknown connection');
    return conn;
  }

  private refOf(conn: BankConnection): BankConnectionRef {
    return {
      id: conn.id,
      buildingId: conn.buildingId,
      institutionName: conn.institutionName,
      iban: conn.iban,
      mode: conn.mode,
    };
  }

  private txCreateData(
    conn: BankConnection,
    tx: RawTx,
  ): Prisma.ImportedTransactionCreateInput {
    return {
      connection: { connect: { id: conn.id } },
      buildingId: conn.buildingId,
      externalId: tx.externalId,
      bookedAt: tx.bookedAt,
      amountCents: tx.amountCents,
      remittanceInfo: tx.remittanceInfo ?? null,
    };
  }

  /** Credits only — the match engine pairs positive statement rows. */
  private toParsedRows(txs: RawTx[]) {
    return txs
      .filter((tx) => tx.amountCents > 0)
      .map((tx) => ({
        dateIso: dayIso(tx.bookedAt),
        amountCents: tx.amountCents,
        reference: tx.remittanceInfo ?? '',
      }));
  }

  /**
   * Minimal replica of `BankImportService.findPendingPayments` (that module
   * does not export its service and is off-limits for modification).
   */
  private async findPendingPayments(
    buildingId: string,
  ): Promise<PendingBankPayment[]> {
    const payments = await this.prisma.payment.findMany({
      where: { status: PaymentStatus.PENDING, invoice: { buildingId } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        amountCents: true,
        createdAt: true,
        invoice: {
          select: { periodYearMonth: true, unit: { select: { label: true } } },
        },
      },
    });
    return payments.map((payment) => ({
      paymentId: payment.id,
      amountCents: payment.amountCents,
      invoicePeriodYearMonth: payment.invoice.periodYearMonth,
      createdAtIso: payment.createdAt.toISOString(),
      unitLabel: payment.invoice.unit.label,
    }));
  }

  private toConnectionDto(conn: BankConnection): BankConnectionDto {
    return {
      id: conn.id,
      buildingId: conn.buildingId,
      institutionName: conn.institutionName,
      iban: conn.iban,
      mode: conn.mode,
      lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
      createdAt: conn.createdAt.toISOString(),
    };
  }

  private toTransactionDto(tx: ImportedTransaction): ImportedTransactionSuggestionDto {
    return {
      id: tx.id,
      connectionId: tx.connectionId,
      externalId: tx.externalId,
      bookedAt: tx.bookedAt.toISOString(),
      amountCents: tx.amountCents,
      remittanceInfo: tx.remittanceInfo,
      suggestionConfidence: null,
    };
  }
}
