import { BadRequestException } from '@nestjs/common';

import type { Subscription as SubscriptionRecord } from '@prisma/client';

import { deriveStatus, SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

const record = (
  overrides: Partial<SubscriptionRecord> = {},
): SubscriptionRecord =>
  ({
    id: 'sub-1',
    buildingId: 'building-1',
    tier: 'BASIC',
    status: 'TRIALING',
    billingCycle: 'MONTHLY',
    units: 6,
    pricePerUnitCents: 150,
    trialEndsAt: new Date('2999-01-01T00:00:00.000Z'),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }) as SubscriptionRecord;

function makePrisma() {
  const prisma = {
    subscription: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    unit: { count: jest.fn() },
  };
  return prisma;
}

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SubscriptionsService(prisma as unknown as PrismaService);
  });

  describe('getOrCreate', () => {
    it('returns the existing subscription without creating', async () => {
      prisma.subscription.findUnique.mockResolvedValue(record());

      const dto = await service.getOrCreate('building-1');

      expect(dto.tier).toBe('BASIC');
      expect(dto.derivedStatus).toBe('TRIALING');
      expect(dto.nextChargeCents).toBe(900);
      expect(prisma.subscription.create).not.toHaveBeenCalled();
    });

    it('creates a trialing BASIC default with live unit count and 60-day trial', async () => {
      prisma.subscription.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.unit.count.mockResolvedValue(7);
      prisma.subscription.create.mockImplementation(async ({ data }) =>
        record({ id: 'sub-2', ...data }),
      );

      const before = Date.now();
      const dto = await service.getOrCreate('building-1');

      expect(prisma.unit.count).toHaveBeenCalledWith({
        where: { buildingId: 'building-1' },
      });
      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          tier: 'BASIC',
          status: 'TRIALING',
          billingCycle: 'MONTHLY',
          units: 7,
          pricePerUnitCents: 150,
        }),
      });
      const data = prisma.subscription.create.mock.calls[0][0].data;
      const trial = (data.trialEndsAt as Date).getTime();
      expect(trial).toBeGreaterThanOrEqual(before + 60 * 24 * 60 * 60 * 1000);
      expect(trial).toBeLessThan(Date.now() + 61 * 24 * 60 * 60 * 1000);
      expect(dto.id).toBe('sub-2');
    });
  });

  describe('changeTier', () => {
    it('rejects buildings under the minimum units', async () => {
      prisma.unit.count.mockResolvedValue(3);

      await expect(
        service.changeTier('building-1', {
          tier: 'PRO',
          billingCycle: 'MONTHLY',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });

    it('updates tier, cycle and per-unit price while keeping status', async () => {
      prisma.unit.count.mockResolvedValue(6);
      prisma.subscription.findUnique.mockResolvedValue(record());
      prisma.subscription.update.mockResolvedValue(
        record({
          tier: 'PREMIUM',
          billingCycle: 'ANNUAL',
          pricePerUnitCents: 300,
        }),
      );

      const dto = await service.changeTier('building-1', {
        tier: 'PREMIUM',
        billingCycle: 'ANNUAL',
      });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({
          tier: 'PREMIUM',
          billingCycle: 'ANNUAL',
          pricePerUnitCents: 300,
          units: 6,
        }),
      });
      expect(dto.status).toBe('TRIALING');
      expect(dto.nextChargeCents).toBe(18360);
    });

    it('reactivates a cancelled subscription on tier change', async () => {
      prisma.unit.count.mockResolvedValue(6);
      prisma.subscription.findUnique.mockResolvedValue(
        record({ status: 'CANCELLED', cancelAt: new Date() }),
      );
      prisma.subscription.update.mockResolvedValue(record({ tier: 'PRO' }));

      await service.changeTier('building-1', {
        tier: 'PRO',
        billingCycle: 'MONTHLY',
      });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: expect.objectContaining({ tier: 'PRO', status: 'ACTIVE' }),
      });
    });
  });

  describe('activatePeriod', () => {
    it('opens a one-month period for monthly cycles', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        record({ status: 'PAST_DUE' }),
      );
      prisma.subscription.update.mockResolvedValue(
        record({ status: 'ACTIVE' }),
      );

      await service.activatePeriod('building-1');

      const { data } = prisma.subscription.update.mock.calls[0][0];
      expect(data.status).toBe('ACTIVE');
      const days =
        ((data.currentPeriodEnd as Date).getTime() -
          (data.currentPeriodStart as Date).getTime()) /
        (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThanOrEqual(28);
      expect(days).toBeLessThanOrEqual(31);
    });

    it('opens a one-year period for annual cycles', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        record({ billingCycle: 'ANNUAL' }),
      );
      prisma.subscription.update.mockResolvedValue(record());

      await service.activatePeriod('building-1');

      const { data } = prisma.subscription.update.mock.calls[0][0];
      const days =
        ((data.currentPeriodEnd as Date).getTime() -
          (data.currentPeriodStart as Date).getTime()) /
        (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThanOrEqual(365);
      expect(days).toBeLessThanOrEqual(366);
    });
  });

  describe('cancel', () => {
    it('schedules cancellation at the end of the running period', async () => {
      const periodEnd = new Date('2999-06-30T00:00:00.000Z');
      prisma.subscription.findUnique.mockResolvedValue(
        record({ currentPeriodEnd: periodEnd }),
      );
      prisma.subscription.update.mockResolvedValue(
        record({ status: 'CANCELLED', cancelAt: periodEnd }),
      );

      const dto = await service.cancel('building-1');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'CANCELLED', cancelAt: periodEnd },
      });
      expect(dto.cancelAt).toBe(periodEnd.toISOString());
    });

    it('cancels immediately while still trialing without a period', async () => {
      prisma.subscription.findUnique.mockResolvedValue(record());
      prisma.subscription.update.mockResolvedValue(
        record({ status: 'CANCELLED' }),
      );

      await service.cancel('building-1');

      const { data } = prisma.subscription.update.mock.calls[0][0];
      expect(data.status).toBe('CANCELLED');
      expect((data.cancelAt as Date).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('deriveStatus', () => {
    it('maps an expired trial to PAST_DUE without mutating the row', () => {
      expect(
        deriveStatus({
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() - 1000),
        }),
      ).toBe('PAST_DUE');
    });

    it('keeps TRIALING while the trial is running', () => {
      expect(
        deriveStatus({
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() + 86_400_000),
        }),
      ).toBe('TRIALING');
    });

    it('passes through non-trialing statuses and missing dates', () => {
      expect(deriveStatus({ status: 'ACTIVE', trialEndsAt: null })).toBe(
        'ACTIVE',
      );
      expect(deriveStatus({ status: 'CANCELLED', trialEndsAt: null })).toBe(
        'CANCELLED',
      );
      expect(deriveStatus({ status: 'TRIALING', trialEndsAt: null })).toBe(
        'TRIALING',
      );
    });
  });
});
