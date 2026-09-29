import { BadRequestException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PublicApiService } from './public-api.service';

function makePrisma() {
  return {
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    vote: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('PublicApiService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: PublicApiService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new PublicApiService(prisma as unknown as PrismaService);
  });

  describe('invoices', () => {
    it('returns the building ledger with unit labels (tenant isolation)', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          periodYearMonth: '2026-07',
          totalCents: 10_000,
          paidCents: 4_000,
          status: PaymentStatus.PENDING,
          unit: { label: 'Α1' },
        },
        {
          id: 'inv-2',
          periodYearMonth: '2026-07',
          totalCents: 5_000,
          paidCents: 5_000,
          status: PaymentStatus.PAID,
          unit: { label: 'Β1' },
        },
      ]);

      const rows = await service.invoices('building-1');

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { buildingId: 'building-1' } }),
      );
      expect(rows[0]).toEqual({
        id: 'inv-1',
        unitLabel: 'Α1',
        periodYearMonth: '2026-07',
        totalCents: 10_000,
        paidCents: 4_000,
        balanceCents: 6_000,
        status: 'PENDING',
      });
      expect(rows[1].balanceCents).toBe(0);
    });

    it('filters by an optional YYYY-MM period', async () => {
      await service.invoices('building-1', '2026-07');
      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buildingId: 'building-1', periodYearMonth: '2026-07' },
        }),
      );
    });

    it('rejects malformed periods with 400', async () => {
      await expect(service.invoices('building-1', '2026/07')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('paymentsSummary', () => {
    it('totals paid/outstanding and counts invoices by status', async () => {
      prisma.invoice.findMany.mockResolvedValue([
        { totalCents: 10_000, paidCents: 10_000, status: PaymentStatus.PAID },
        { totalCents: 8_000, paidCents: 3_000, status: PaymentStatus.PENDING },
        { totalCents: 2_000, paidCents: 0, status: PaymentStatus.PAID },
        { totalCents: 4_000, paidCents: 9_000, status: PaymentStatus.REFUNDED },
      ]);

      await expect(
        service.paymentsSummary('building-1'),
      ).resolves.toEqual({
        paidCents: 22_000,
        outstandingCents: 7_000,
        countByStatus: { PAID: 2, PENDING: 1, REFUNDED: 1 },
      });
    });
  });

  describe('voteResults', () => {
    it('tallies closed votes only, mapping ABSTAIN to white', async () => {
      prisma.vote.findMany.mockResolvedValue([
        {
          id: 'vote-1',
          topic: 'Αντικατάσταση ασανσέρ',
          thresholdType: 'MILLIMES_MAJORITY',
          closesAt: new Date('2026-08-01T00:00:00.000Z'),
          result: 'PASSED',
          ballots: [
            { choice: 'YES' },
            { choice: 'YES' },
            { choice: 'NO' },
            { choice: 'ABSTAIN' },
          ],
        },
      ]);

      const results = await service.voteResults('building-1');

      expect(prisma.vote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            buildingId: 'building-1',
            closesAt: { lte: expect.any(Date) },
          },
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'vote-1',
        topic: 'Αντικατάσταση ασανσέρ',
        result: 'PASSED',
        tally: { yesCount: 2, noCount: 1, whiteCount: 1, totalCount: 4 },
      });
    });
  });
});
