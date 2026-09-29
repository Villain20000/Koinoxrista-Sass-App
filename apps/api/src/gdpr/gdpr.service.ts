import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import {
  anonymizeName,
  anonymizedEmail,
  randomPasswordHash,
} from './gdpr-anonymizer';
import type { GdprExportDto } from './gdpr.dto';

/** Erasure keeps financial/voting rows (legal hold) — only PII is scrubbed. */
const ERASED_NAME = anonymizeName();

@Injectable()
export class GdprService {
  constructor(private readonly prisma: PrismaService) {}

  async exportUserData(userId: string): Promise<GdprExportDto> {
    const [user, ownerships] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          buildingId: true,
          createdAt: true,
        },
      }),
      this.prisma.ownership.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        include: { unit: { select: { label: true } } },
      }),
    ]);

    const unitIds = ownerships.map((ownership) => ownership.unitId);

    const [invoices, ballots, bids, workLogs, providerProfile, documents] =
      await Promise.all([
        this.prisma.invoice.findMany({
          where: { unitId: { in: unitIds } },
          orderBy: [{ periodYearMonth: 'desc' }, { id: 'asc' }],
          include: { payments: { orderBy: { createdAt: 'asc' } } },
        }),
        this.prisma.ballot.findMany({
          where: { unitId: { in: unitIds } },
          orderBy: { id: 'asc' },
          include: { vote: { select: { topic: true } } },
        }),
        this.prisma.bid.findMany({
          where: { providerUserId: userId },
          orderBy: { id: 'asc' },
        }),
        this.prisma.workLog.findMany({
          where: { providerUserId: userId },
          orderBy: { loggedAt: 'asc' },
        }),
        this.prisma.providerProfile.findUnique({ where: { userId } }),
        this.prisma.document.findMany({
          where: { uploadedById: userId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    await this.prisma.gdprRequest.create({
      data: {
        userId,
        buildingId: user.buildingId,
        type: 'EXPORT',
        status: 'COMPLETED',
        resultKey: 'inline',
        completedAt: new Date(),
      },
    });

    return {
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
      },
      ownerships: ownerships.map((ownership) => ({
        unitLabel: ownership.unit.label,
        shareMillimes: ownership.shareMillimes,
        periodStart: ownership.periodStart?.toISOString() ?? null,
      })),
      invoicesOfOwnedUnits: invoices.map((invoice) => ({
        id: invoice.id,
        periodYearMonth: invoice.periodYearMonth,
        totalCents: invoice.totalCents,
        paidCents: invoice.paidCents,
        status: invoice.status,
        payments: invoice.payments.map((payment) => ({
          method: payment.method,
          amountCents: payment.amountCents,
          status: payment.status,
          pspRef: payment.pspRef,
          createdAt: payment.createdAt.toISOString(),
        })),
      })),
      ballots: ballots.map((ballot) => ({
        voteTopic: ballot.vote.topic,
        choice: ballot.choice,
      })),
      bids: bids.map((bid) => ({
        id: bid.id,
        jobId: bid.jobId,
        amountCents: bid.amountCents,
        message: bid.message,
        status: bid.status,
        ratingStars: bid.ratingStars,
      })),
      workLogs: workLogs.map((workLog) => ({
        id: workLog.id,
        jobId: workLog.jobId,
        note: workLog.note,
        loggedAt: workLog.loggedAt.toISOString(),
      })),
      providerProfile: providerProfile
        ? {
            trade: providerProfile.trade,
            certs: providerProfile.certs,
            rating: providerProfile.rating,
          }
        : null,
      documents: documents.map((document) => ({
        fileName: document.fileName,
        type: document.type,
        sizeBytes: document.sizeBytes,
        createdAt: document.createdAt.toISOString(),
      })),
    };
  }

  async deleteAccount(userId: string): Promise<{ anonymized: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true },
      });

      // Rows are never deleted — FKs from invoices/bids/workLogs stay intact.
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail(user.email),
          firstName: ERASED_NAME,
          lastName: ERASED_NAME,
          phone: null,
          passwordHash: randomPasswordHash(),
        },
      });
      await tx.membership.deleteMany({ where: { userId } });
      await tx.apiKey.deleteMany({ where: { userId } });
      await tx.providerProfile.deleteMany({ where: { userId } });
      await tx.gdprRequest.create({
        data: {
          userId,
          type: 'DELETE',
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
    });

    return { anonymized: true };
  }
}
