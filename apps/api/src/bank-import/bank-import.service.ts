import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentOrderState,
  PaymentStatus,
} from '@prisma/client';
import type {
  BankImportApplyResponse,
  BankImportPreviewResponse,
} from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ApplyBankImportDto } from './dto/bank-import.dto';
import {
  suggestMatches,
  PendingBankPayment,
} from './match-bank-payments';
import { parseBankCsv } from './parse-bank-csv';

@Injectable()
export class BankImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(
    buildingId: string,
    user: AuthenticatedUser,
    csv: string,
  ): Promise<BankImportPreviewResponse> {
    assertSameBuilding(user, buildingId);
    const rows = parseBankCsv(csv);
    const pending = await this.findPendingPayments(buildingId);
    return { rows, pending, suggestions: suggestMatches(rows, pending) };
  }

  /**
   * Applies user-confirmed matches. Each match runs in its own transaction
   * mirroring the Viva webhook settlement: payment → PAID/IRIS with the bank
   * reference as pspRef, invoice paidCents increment + status recompute and
   * stale pending orders completed. Already-PAID payments are skipped.
   */
  async apply(
    buildingId: string,
    user: AuthenticatedUser,
    dto: ApplyBankImportDto,
  ): Promise<BankImportApplyResponse> {
    assertSameBuilding(user, buildingId);
    const rows = parseBankCsv(dto.csv);

    let applied = 0;
    let skipped = 0;
    for (const match of dto.matches) {
      const row = rows[match.rowIndex];
      if (!row) {
        throw new BadRequestException(
          `Unknown statement row ${match.rowIndex}`,
        );
      }
      const outcome = await this.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { id: match.paymentId },
          include: { invoice: true },
        });
        if (!payment || payment.invoice.buildingId !== buildingId) {
          throw new BadRequestException('Unknown payment for this building');
        }
        if (payment.status === PaymentStatus.PAID) return 'skipped';

        const invoice = payment.invoice;
        const paidCents = invoice.paidCents + payment.amountCents;
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            method: PaymentMethod.IRIS,
            status: PaymentStatus.PAID,
            pspRef: row.reference,
          },
        });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidCents: { increment: payment.amountCents },
            status:
              paidCents >= invoice.totalCents
                ? PaymentStatus.PAID
                : PaymentStatus.PENDING,
          },
        });
        await tx.paymentOrder.updateMany({
          where: {
            invoiceId: invoice.id,
            status: PaymentOrderState.PENDING,
          },
          data: { status: PaymentOrderState.COMPLETED },
        });
        this.audit.record({
          buildingId,
          actorId: user.id,
          actorRole: user.role,
          action: 'payment.bank-import',
          entity: 'payment',
          entityId: payment.id,
          metadata: {
            invoiceId: invoice.id,
            amountCents: payment.amountCents,
            pspRef: row.reference,
            rowIndex: match.rowIndex,
          },
        });
        return 'applied';
      });
      if (outcome === 'applied') applied++;
      else skipped++;
    }
    return { applied, skipped };
  }

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
    return payments.map((payment): PendingBankPayment => ({
      paymentId: payment.id,
      amountCents: payment.amountCents,
      invoicePeriodYearMonth: payment.invoice.periodYearMonth,
      createdAtIso: payment.createdAt.toISOString(),
      unitLabel: payment.invoice.unit.label,
    }));
  }
}
