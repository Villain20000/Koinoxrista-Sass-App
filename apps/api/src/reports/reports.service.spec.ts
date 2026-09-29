import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import {
  DEFAULT_MONTHS,
  MAX_MONTHS,
  MIN_MONTHS,
  ReportsService,
  clampArrears,
  collectionRatePct,
  parseMonths,
  periodWindow,
} from './reports.service';
import { PrismaService } from '../prisma/prisma.service';

const admin = (buildingId: string | null = 'building-1'): AuthenticatedUser => ({
  id: 'user-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId,
});

function makePrisma() {
  return {
    invoice: { groupBy: jest.fn().mockResolvedValue([]) },
    expense: { groupBy: jest.fn().mockResolvedValue([]) },
    expenseCategory: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('parseMonths', () => {
  it('defaults to 12 for missing or empty values', () => {
    expect(parseMonths(undefined)).toBe(DEFAULT_MONTHS);
    expect(parseMonths('')).toBe(DEFAULT_MONTHS);
  });

  it.each(['3', '12', '24'])('accepts %s within bounds', (raw) => {
    expect(parseMonths(raw)).toBe(Number(raw));
  });

  it.each(['2', '25', '0', '-6', '4.5', 'abc', 'NaN'])(
    'rejects %s with 400',
    (raw) => {
      expect(() => parseMonths(raw)).toThrow(BadRequestException);
    },
  );
});

describe('periodWindow', () => {
  it('ends at the current month and spans exactly `months` periods', () => {
    const now = new Date(Date.UTC(2026, 7, 15));
    expect(periodWindow(5, now)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
    ]);
    expect(periodWindow(24, now)).toHaveLength(24);
  });

  it('crosses the year boundary correctly', () => {
    const now = new Date(Date.UTC(2026, 0, 31));
    expect(periodWindow(3, now)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
  });
});

describe('clampArrears / collectionRatePct', () => {
  it('clamps over-collection to zero', () => {
    expect(clampArrears(10_000, 12_000)).toBe(0);
    expect(clampArrears(10_000, 4_000)).toBe(6_000);
  });

  it('rounds the rate and guards zero division', () => {
    expect(collectionRatePct(0, 0)).toBe(0);
    expect(collectionRatePct(1, 0)).toBe(0);
    expect(collectionRatePct(8_333, 10_000)).toBe(83);
    expect(collectionRatePct(10_000, 10_000)).toBe(100);
  });
});

describe('ReportsService.summary', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ReportsService;
  const now = new Date(Date.UTC(2026, 7, 15));

  beforeEach(() => {
    prisma = makePrisma();
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  it('rejects users attached to another building', async () => {
    await expect(
      service.summary('building-2', admin('building-1'), '12', now),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.summary('building-1', admin(null), '12', now),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects out-of-range months with 400', async () => {
    await expect(
      service.summary('building-1', admin(), String(MAX_MONTHS + 1), now),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.summary('building-1', admin(), String(MIN_MONTHS - 1), now),
    ).rejects.toThrow(BadRequestException);
  });

  it('aggregates invoiced/collected per period and zero-fills gaps', async () => {
    prisma.invoice.groupBy.mockImplementation(({ where }) =>
      Promise.resolve(
        where.periodYearMonth.in
          .filter((p: string) => p === '2026-07' || p === '2026-08')
          .map((periodYearMonth: string, index: number) => ({
            periodYearMonth,
            _sum:
              index === 0
                ? { totalCents: 100_000, paidCents: 75_500 }
                : { totalCents: 120_000, paidCents: 130_000 },
          })),
      ),
    );

    const result = await service.summary('building-1', admin(), '3', now);

    expect(result.periods).toEqual([
      {
        periodYearMonth: '2026-06',
        invoicedCents: 0,
        collectedCents: 0,
        arrearsCents: 0,
      },
      {
        periodYearMonth: '2026-07',
        invoicedCents: 100_000,
        collectedCents: 75_500,
        arrearsCents: 24_500,
      },
      {
        periodYearMonth: '2026-08',
        invoicedCents: 120_000,
        collectedCents: 130_000,
        arrearsCents: 0,
      },
    ]);
    expect(result.totals).toEqual({
      invoicedCents: 220_000,
      collectedCents: 205_500,
      arrearsCents: 24_500,
      collectionRatePct: 93,
    });
    expect(prisma.invoice.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['periodYearMonth'],
        where: {
          buildingId: 'building-1',
          periodYearMonth: {
            in: ['2026-06', '2026-07', '2026-08'],
          },
        },
      }),
    );
  });

  it('maps expense categories to names sorted by descending total', async () => {
    prisma.expense.groupBy.mockResolvedValue([
      { categoryId: 'cat-b', _sum: { totalCents: 20_000 } },
      { categoryId: 'cat-a', _sum: { totalCents: 55_000 } },
      { categoryId: 'cat-x', _sum: { totalCents: 5_000 } },
    ]);
    prisma.expenseCategory.findMany.mockResolvedValue([
      { id: 'cat-a', name: 'Καθαριότητα' },
      { id: 'cat-b', name: 'Ανελκυστήρας' },
    ]);

    const result = await service.summary('building-1', admin(), '12', now);

    expect(prisma.expenseCategory.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['cat-b', 'cat-a', 'cat-x'] },
        buildingId: 'building-1',
      },
      select: { id: true, name: true },
    });
    expect(result.expensesByCategory).toEqual([
      { categoryName: 'Καθαριότητα', totalCents: 55_000 },
      { categoryName: 'Ανελκυστήρας', totalCents: 20_000 },
      { categoryName: 'Λοιπές δαπάνες', totalCents: 5_000 },
    ]);
  });

  it('returns empty structures when there is no data in the window', async () => {
    const result = await service.summary('building-1', admin(), undefined, now);

    expect(result.periods).toHaveLength(12);
    expect(
      result.periods.every((point) => point.invoicedCents === 0),
    ).toBe(true);
    expect(result.expensesByCategory).toEqual([]);
    expect(result.totals).toEqual({
      invoicedCents: 0,
      collectedCents: 0,
      arrearsCents: 0,
      collectionRatePct: 0,
    });
    expect(prisma.expenseCategory.findMany).not.toHaveBeenCalled();
  });
});
