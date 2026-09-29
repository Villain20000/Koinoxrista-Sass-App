import { PrismaService } from '../prisma/prisma.service';
import { GdprService } from './gdpr.service';

type EraseTx = {
  user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  membership: { deleteMany: jest.Mock };
  apiKey: { deleteMany: jest.Mock };
  providerProfile: { deleteMany: jest.Mock };
  gdprRequest: { create: jest.Mock };
};

function makePrisma() {
  const tx: EraseTx = {
    user: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ email: 'maria@demo.gr' }),
      update: jest.fn().mockResolvedValue({}),
    },
    membership: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    apiKey: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    providerProfile: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    gdprRequest: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'maria@demo.gr',
        firstName: 'Μαρία',
        lastName: 'Παπαδοπούλου',
        phone: '6944123456',
        role: 'RESIDENT',
        buildingId: 'building-1',
        createdAt: new Date('2025-01-15T09:00:00Z'),
      }),
      update: jest.fn(),
    },
    ownership: {
      findMany: jest.fn().mockResolvedValue([
        {
          unitId: 'unit-a',
          shareMillimes: 500,
          periodStart: null,
          unit: { label: 'Α1' },
        },
      ]),
      deleteMany: undefined,
    },
    invoice: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'inv-1',
          periodYearMonth: '2026-07',
          totalCents: 10_000,
          paidCents: 4_000,
          status: 'PARTIAL',
          payments: [
            {
              method: 'CARD',
              amountCents: 4_000,
              status: 'COMPLETED',
              pspRef: 'psp-1',
              createdAt: new Date('2026-07-05T10:00:00Z'),
            },
          ],
        },
      ]),
      // Financial rows are retained — no deletion delegate exists.
      deleteMany: undefined,
    },
    ballot: {
      findMany: jest.fn().mockResolvedValue([
        { choice: 'NAI', vote: { topic: 'Ανελκυστήρας' } },
      ]),
      deleteMany: undefined,
    },
    unit: { deleteMany: undefined },
    bid: { findMany: jest.fn().mockResolvedValue([]) },
    workLog: { findMany: jest.fn().mockResolvedValue([]) },
    providerProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    document: { findMany: jest.fn().mockResolvedValue([]) },
    gdprRequest: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn: (t: EraseTx) => Promise<unknown>) => fn(tx)),
  };

  return { prisma, tx };
}

describe('GdprService', () => {
  let service: GdprService;
  let prisma: ReturnType<typeof makePrisma>['prisma'];
  let tx: ReturnType<typeof makePrisma>['tx'];

  beforeEach(() => {
    ({ prisma, tx } = makePrisma());
    service = new GdprService(prisma as unknown as PrismaService);
  });

  describe('exportUserData', () => {
    it('assembles every personal-data collection', async () => {
      const data = await service.exportUserData('user-1');

      expect(data.profile).toMatchObject({
        id: 'user-1',
        email: 'maria@demo.gr',
        firstName: 'Μαρία',
      });
      expect(data.ownerships).toEqual([
        { unitLabel: 'Α1', shareMillimes: 500, periodStart: null },
      ]);
      expect(data.invoicesOfOwnedUnits).toHaveLength(1);
      expect(data.invoicesOfOwnedUnits[0].payments[0]).toMatchObject({
        method: 'CARD',
        amountCents: 4_000,
      });
      expect(data.ballots).toEqual([
        { voteTopic: 'Ανελκυστήρας', choice: 'NAI' },
      ]);
      expect(data.bids).toEqual([]);
      expect(data.workLogs).toEqual([]);
      expect(data.providerProfile).toBeNull();
      expect(data.documents).toEqual([]);
      expect(new Date(data.exportedAt).getTime()).not.toBeNaN();
    });

    it('records a completed EXPORT GdprRequest row', async () => {
      await service.exportUserData('user-1');

      expect(prisma.gdprRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          type: 'EXPORT',
          status: 'COMPLETED',
          resultKey: 'inline',
        }),
      });
    });
  });

  describe('deleteAccount', () => {
    it('scrubs PII and revokes credentials inside one transaction', async () => {
      await expect(service.deleteAccount('user-1')).resolves.toEqual({
        anonymized: true,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const updateData = tx.user.update.mock.calls[0][0].data;
      expect(updateData.email).toMatch(
        /^deleted\+[0-9a-f]{10}@anonymized\.invalid$/,
      );
      expect(updateData.firstName).toBe('Ανώνυμος');
      expect(updateData.lastName).toBe('Ανώνυμος');
      expect(updateData.phone).toBeNull();
      expect(updateData.passwordHash).toMatch(/^[0-9a-f]{64}$/);
      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );

      expect(tx.membership.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(tx.apiKey.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(tx.providerProfile.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });

    it('keeps financial/voting rows and logs a DELETE request', async () => {
      await service.deleteAccount('user-1');

      // Retention: invoice/unit/ownership/bid/workLog rows are never touched.
      expect(prisma.invoice.deleteMany).toBeUndefined();
      expect(prisma.unit.deleteMany).toBeUndefined();
      expect(prisma.ownership.deleteMany).toBeUndefined();
      expect(prisma.ballot.deleteMany).toBeUndefined();

      expect(tx.gdprRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          type: 'DELETE',
          status: 'COMPLETED',
        }),
      });
    });

    it('is safe to rerun on an already-anonymized account', async () => {
      await service.deleteAccount('user-1');
      tx.membership.deleteMany.mockClear();
      tx.providerProfile.deleteMany.mockClear();

      await expect(service.deleteAccount('user-1')).resolves.toEqual({
        anonymized: true,
      });
      // deleteMany no-ops instead of throwing P2025 like delete would.
      expect(tx.membership.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.providerProfile.deleteMany).toHaveBeenCalledTimes(1);
    });
  });
});
