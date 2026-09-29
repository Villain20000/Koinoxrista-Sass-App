import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { SubscriptionDto } from '@org/shared';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  PlatformInvoiceService,
  type PlatformInvoiceRow,
} from './platform-invoice.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

const outsider: AuthenticatedUser = {
  id: 'admin-9',
  email: 'other@example.gr',
  role: Role.ADMIN,
  buildingId: 'building-2',
};

const sub = (overrides: Partial<SubscriptionDto> = {}): SubscriptionDto =>
  ({
    id: 'sub-1',
    buildingId: 'building-1',
    tier: 'BASIC',
    status: 'ACTIVE',
    derivedStatus: 'ACTIVE',
    billingCycle: 'MONTHLY',
    units: 6,
    pricePerUnitCents: 150,
    nextChargeCents: 900,
    trialEndsAt: null,
    currentPeriodStart: '2026-08-01T00:00:00.000Z',
    currentPeriodEnd: '2026-09-01T00:00:00.000Z',
    cancelAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }) as SubscriptionDto;

const row = (overrides: Partial<PlatformInvoiceRow> = {}): PlatformInvoiceRow =>
  ({
    id: 'pi-1',
    buildingId: 'building-1',
    subscriptionId: 'sub-1',
    number: 'SI-2026-0001',
    period: '2026-08',
    tier: 'BASIC',
    units: 6,
    amountCents: 900,
    status: 'ISSUED',
    issuedAt: new Date('2026-08-25T10:00:00.000Z'),
    paidAt: null,
    ...overrides,
  }) as unknown as PlatformInvoiceRow;

function setup() {
  const invoices = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    platformInvoice: invoices,
  };
  const prisma = {
    platformInvoice: invoices,
    $transaction: jest
      .fn()
      .mockImplementation((cb: (client: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
  };
  const subscriptions = {
    getOrCreate: jest.fn().mockResolvedValue(sub()),
  };
  const audit = { record: jest.fn() };

  const service = new PlatformInvoiceService(
    prisma as unknown as PrismaService,
    subscriptions as unknown as SubscriptionsService,
    audit as unknown as AuditService,
  );
  return { service, prisma, tx, invoices, subscriptions, audit };
}

describe('PlatformInvoiceService', () => {
  describe('runPeriod', () => {
    it('issues SI-2026-0001 on the first run for a monthly ACTIVE subscription', async () => {
      const env = setup();
      env.invoices.findUnique.mockResolvedValue(null);
      env.invoices.create.mockImplementation(async ({ data }) =>
        row({ id: 'pi-new', ...data }),
      );

      const result = await env.service.runPeriod('building-1', '2026-08', admin);

      expect(result.created).toBe(true);
      expect(result.invoice?.number).toBe('SI-2026-0001');
      expect(result.invoice?.amountCents).toBe(900);
      expect(result.invoice?.status).toBe('ISSUED');

      // Advisory lock + max-number lookup ran inside the transaction.
      expect(env.tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(env.tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(env.invoices.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          buildingId: 'building-1',
          subscriptionId: 'sub-1',
          period: '2026-08',
          tier: 'BASIC',
          units: 6,
          amountCents: 900,
          status: 'ISSUED',
        }),
      });
    });

    it('continues the sequence from the highest existing number', async () => {
      const env = setup();
      env.invoices.findUnique.mockResolvedValue(null);
      env.tx.$queryRaw.mockResolvedValue([{ number: 'SI-2026-0041' }]);
      env.invoices.create.mockImplementation(async ({ data }) =>
        row({ ...data }),
      );

      const result = await env.service.runPeriod('building-1', '2026-08', admin);

      expect(result.invoice?.number).toBe('SI-2026-0042');
    });

    it('is idempotent: a second run creates nothing', async () => {
      const env = setup();
      env.invoices.findUnique.mockResolvedValue(row());

      const result = await env.service.runPeriod('building-1', '2026-08', admin);

      expect(result.created).toBe(false);
      expect(result.invoice?.id).toBe('pi-1');
      expect(env.prisma.$transaction).not.toHaveBeenCalled();
      expect(env.invoices.create).not.toHaveBeenCalled();
    });

    it('auto-PAID zero-amount trial periods', async () => {
      const env = setup();
      env.subscriptions.getOrCreate.mockResolvedValue(
        sub({ status: 'TRIALING', trialEndsAt: '2999-01-01T00:00:00.000Z' }),
      );
      env.invoices.findUnique.mockResolvedValue(null);
      env.invoices.create.mockImplementation(async ({ data }) =>
        row({ ...data }),
      );

      const result = await env.service.runPeriod('building-1', '2026-08', admin);

      expect(result.invoice?.amountCents).toBe(0);
      expect(result.invoice?.status).toBe('PAID');
      expect(result.invoice?.paidAt).toBeTruthy();
      const data = env.invoices.create.mock.calls[0][0].data;
      expect(data.status).toBe('PAID');
      expect(data.amountCents).toBe(0);
    });

    it('bills the annual-discounted total only in the anniversary month', async () => {
      const env = setup();
      env.subscriptions.getOrCreate.mockResolvedValue(
        sub({
          billingCycle: 'ANNUAL',
          currentPeriodStart: '2026-08-15T00:00:00.000Z',
        }),
      );
      env.invoices.findUnique.mockResolvedValue(null);
      env.invoices.create.mockImplementation(async ({ data }) =>
        row({ ...data }),
      );

      await env.service.runPeriod('building-1', '2026-08', admin);
      expect(env.invoices.create.mock.calls[0][0].data.amountCents).toBe(9180); // priceFor(BASIC, ANNUAL, 6)

      env.invoices.create.mockClear();
      await env.service.runPeriod('building-1', '2026-09', admin);
      expect(env.invoices.create.mock.calls[0][0].data.amountCents).toBe(0);
    });

    it('rejects malformed periods and foreign buildings', async () => {
      const env = setup();

      await expect(
        env.service.runPeriod('building-1', '2026-13', admin),
      ).rejects.toThrow(BadRequestException);
      await expect(
        env.service.runPeriod('building-1', 'August', admin),
      ).rejects.toThrow(BadRequestException);
      await expect(
        env.service.runPeriod('building-1', '2026-08', outsider),
      ).rejects.toThrow(ForbiddenException);
      expect(env.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('issueForTierChange', () => {
    const before = sub();

    const snapshotOf = (dto: SubscriptionDto) => ({
      id: dto.id,
      buildingId: dto.buildingId,
      tier: dto.tier,
      units: dto.units,
      currentPeriodStart: dto.currentPeriodStart
        ? new Date(dto.currentPeriodStart)
        : null,
      currentPeriodEnd: dto.currentPeriodEnd
        ? new Date(dto.currentPeriodEnd)
        : null,
    });

    it('prorates an upgrade mid-period as its own ADJ invoice', async () => {
      const env = setup();
      jest.useFakeTimers().setSystemTime(new Date('2026-08-11T00:00:00.000Z'));
      try {
        env.invoices.count.mockResolvedValue(0);
        env.invoices.create.mockImplementation(async ({ data }) =>
          row({ ...data }),
        );

        const invoice = await env.service.issueForTierChange(
          snapshotOf(before),
          snapshotOf(sub({ tier: 'PREMIUM' })),
          admin,
        );

        // Aug has 31 days: 10 used, 21 remaining → (300-150)*6*21/31 ≈ 609.7.
        expect(invoice?.amountCents).toBe(610);
        const data = env.invoices.create.mock.calls[0][0].data;
        expect(data.period).toMatch(/^2026-08-ADJ-1$/);
        expect(data.tier).toBe('PREMIUM');
        expect(data.status).toBe('ISSUED');
      } finally {
        jest.useRealTimers();
      }
    });

    it('skips downgrades and buildings without an open period', async () => {
      const env = setup();

      expect(
        await env.service.issueForTierChange(
          snapshotOf(sub({ tier: 'PREMIUM' })),
          snapshotOf(before),
          admin,
        ),
      ).toBeNull();
      expect(
        await env.service.issueForTierChange(
          snapshotOf(sub({ currentPeriodStart: null, currentPeriodEnd: null })),
          snapshotOf(sub({ tier: 'PREMIUM' })),
          admin,
        ),
      ).toBeNull();
      expect(env.invoices.create).not.toHaveBeenCalled();
    });
  });

  describe('list / getOne', () => {
    it('lists newest first for the same building only', async () => {
      const env = setup();
      env.invoices.findMany.mockResolvedValue([row()]);

      const items = await env.service.list('building-1', admin);

      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(
        expect.objectContaining({
          id: 'pi-1',
          number: 'SI-2026-0001',
          status: 'ISSUED',
          issuedAt: '2026-08-25T10:00:00.000Z',
        }),
      );
      const call = env.invoices.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ buildingId: 'building-1' });
      expect(call.orderBy).toEqual({ issuedAt: 'desc' });
    });

    it('refuses foreign buildings when listing or fetching one', async () => {
      const env = setup();

      await expect(env.service.list('building-1', outsider)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        env.service.getOne('building-1', 'pi-1', outsider),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound for a missing invoice id', async () => {
      const env = setup();
      env.invoices.findFirst.mockResolvedValue(null);

      await expect(
        env.service.getOne('building-1', 'missing', admin),
      ).rejects.toThrow('Platform invoice not found');
    });
  });

  describe('auditing', () => {
    it('records platform_invoice.issued with trigger metadata', async () => {
      const env = setup();
      env.invoices.findUnique.mockResolvedValue(null);
      env.invoices.create.mockImplementation(async ({ data }) =>
        row({ ...data }),
      );

      await env.service.runPeriod('building-1', '2026-08', admin);

      expect(env.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform_invoice.issued',
          entity: 'PlatformInvoice',
          actorId: 'admin-1',
          metadata: expect.objectContaining({
            trigger: 'PERIOD_RUN',
            number: 'SI-2026-0001',
          }),
        }),
      );
    });
  });
});
