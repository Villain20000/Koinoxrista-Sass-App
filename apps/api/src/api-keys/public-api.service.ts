import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaymentStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type {
  PublicInvoiceDto as PublicInvoiceRow,
  PublicPaymentSummaryDto as PublicPaymentSummary,
  PublicVoteResultDto as PublicVoteResultRow,
} from '@org/shared';

const PERIOD_PATTERN = /^\d{4}-\d{2}$/;
const CHOICE_TO_TALLY: Record<string, 'yesCount' | 'noCount' | 'whiteCount'> = {
  YES: 'yesCount',
  NO: 'noCount',
  ABSTAIN: 'whiteCount',
};

@Injectable()
export class PublicApiService {
  constructor(private readonly prisma: PrismaService) {}

  async invoices(
    buildingId: string,
    periodYearMonth?: string,
  ): Promise<PublicInvoiceRow[]> {
    if (periodYearMonth && !PERIOD_PATTERN.test(periodYearMonth)) {
      throw new BadRequestException('periodYearMonth must be YYYY-MM');
    }
    const rows = await this.prisma.invoice.findMany({
      where: {
        buildingId,
        ...(periodYearMonth ? { periodYearMonth } : {}),
      },
      include: { unit: { select: { label: true } } },
      orderBy: [{ periodYearMonth: 'desc' }, { unit: { label: 'asc' } }],
    });
    return rows.map((row) => ({
      id: row.id,
      unitLabel: row.unit.label,
      periodYearMonth: row.periodYearMonth,
      totalCents: row.totalCents,
      paidCents: row.paidCents,
      balanceCents: Math.max(row.totalCents - row.paidCents, 0),
      status: row.status as string,
    }));
  }

  async paymentsSummary(buildingId: string): Promise<PublicPaymentSummary> {
    const rows = await this.prisma.invoice.findMany({
      where: { buildingId },
      select: { totalCents: true, paidCents: true, status: true },
    });
    const countByStatus: Record<string, number> = {};
    let paidCents = 0;
    let outstandingCents = 0;
    for (const row of rows) {
      paidCents += row.paidCents;
      outstandingCents += Math.max(row.totalCents - row.paidCents, 0);
      const status = row.status as PaymentStatus | string;
      countByStatus[status] = (countByStatus[status] ?? 0) + 1;
    }
    return { paidCents, outstandingCents, countByStatus };
  }

  async voteResults(buildingId: string): Promise<PublicVoteResultRow[]> {
    const votes = await this.prisma.vote.findMany({
      where: { buildingId, closesAt: { lte: new Date() } },
      include: { ballots: { select: { choice: true } } },
      orderBy: { closesAt: 'desc' },
    });
    return votes.map((vote) => {
      const tally = {
        yesCount: 0,
        noCount: 0,
        whiteCount: 0,
        totalCount: vote.ballots.length,
      };
      for (const ballot of vote.ballots) {
        const bucket = CHOICE_TO_TALLY[ballot.choice];
        if (bucket) tally[bucket] += 1;
      }
      return {
        id: vote.id,
        topic: vote.topic,
        thresholdType: vote.thresholdType,
        closesAt: vote.closesAt.toISOString(),
        result: vote.result,
        tally,
      };
    });
  }
}
