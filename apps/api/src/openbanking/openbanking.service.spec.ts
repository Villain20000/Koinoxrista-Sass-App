import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  BankFeedAdapter,
  RawTx,
} from './openbanking.adapter';
import { OfflineBankFeedAdapter } from './openbanking.adapter';
import { OpenBankingService } from './openbanking.service';

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'admin@building.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

const connection = {
  id: 'conn-1',
  buildingId: 'building-1',
  institutionName: 'Τράπεζα',
  iban: 'GR1601101250000000012300695',
  mode: 'offline',
  lastSyncedAt: null as Date | null,
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
};

type AuditMock = { record: jest.Mock };

function makePrisma() {
  return {
    bankConnection: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...connection,
          ...data,
          lastSyncedAt: null,
          createdAt: new Date('2026-08-25T10:00:00.000Z'),
        }),
      ),
      findMany: jest.fn().mockResolvedValue([connection]),
      findFirst: jest.fn().mockResolvedValue(connection),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    importedTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve({
            id: `tx-${where.connectionId_externalId.externalId}`,
          }),
        ),
    },
    payment: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function setup(
  prisma: ReturnType<typeof makePrisma>,
  adapter: BankFeedAdapter,
): { service: OpenBankingService; audit: AuditMock } {
  const audit: AuditMock = { record: jest.fn() };
  const service = new OpenBankingService(
    prisma as unknown as PrismaService,
    audit as never,
    adapter,
  );
  return { service, audit };
}

function rawTx(overrides: Partial<RawTx> = {}): RawTx {
  return {
    externalId: 'OFF-ABC',
    bookedAt: new Date(Date.parse('2026-08-20T12:00:00Z')),
    amountCents: 12_400,
    remittanceInfo: 'ΣΥΝΔΡΟΜΗ Α1',
    ...overrides,
  };
}

describe('OpenBankingService.createConnection', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: OpenBankingService;
  let audit: AuditMock;

  beforeEach(() => {
    delete process.env.OPENBANKING_MODE;
    prisma = makePrisma();
    ({ service, audit } = setup(prisma, new OfflineBankFeedAdapter()));
  });

  it('normalizes the IBAN and audits the creation', async () => {
    await expect(
      service.createConnection(
        'building-1',
        user,
        { iban: ' gr16 01101250000000012300695 ', institutionName: ' ' },
      ),
    ).resolves.toMatchObject({
      iban: 'GR1601101250000000012300695',
      institutionName: 'Τράπεζα', // blank name falls back to the default
      mode: 'offline',
    });

    expect(prisma.bankConnection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildingId: 'building-1',
        iban: 'GR1601101250000000012300695',
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'openbanking.connection.create' }),
    );
  });

  it('translates a unique conflict into 409', async () => {
    prisma.bankConnection.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(
      service.createConnection('building-1', user, {
        iban: 'GR1601101250000000012300695',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses another building with 403', async () => {
    await expect(
      service.createConnection('building-9', user, {
        iban: 'GR1601101250000000012300695',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.bankConnection.create).not.toHaveBeenCalled();
  });
});

describe('OpenBankingService.sync', () => {
  function syncSetup(adapter: BankFeedAdapter) {
    const prisma = makePrisma();
    return { prisma, ...setup(prisma, adapter) };
  }

  it('upserts pulled rows skipping known externalIds and reports suggestion counts', async () => {
    const adapter: BankFeedAdapter = {
      listTransactions: jest.fn().mockResolvedValue([
        rawTx(), // matches payment-1: same amount, unit label in remittance
        rawTx({ externalId: 'OFF-KNOWN', amountCents: 5_000 }),
        rawTx({
          externalId: 'OFF-DEBIT',
          amountCents: -3_000,
          remittanceInfo: 'ΔΕΗ ΚΟΙΝΟΧΡΗΣΤΑ',
        }),
      ]),
    };
    const { prisma, service, audit } = syncSetup(adapter);
    prisma.importedTransaction.findMany.mockResolvedValue([
      { externalId: 'OFF-KNOWN' },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        amountCents: 12_400,
        createdAt: new Date('2026-08-19T09:00:00.000Z'),
        invoice: { periodYearMonth: '2026-08', unit: { label: 'Α1' } },
      },
    ]);

    await expect(service.sync('conn-1', user)).resolves.toEqual({
      newCount: 2,
      high: 1,
      medium: 0,
      low: 0,
    });

    expect(adapter.listTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ iban: connection.iban }),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    // Every pulled row is upserted (idempotent), even already-known ones.
    expect(prisma.importedTransaction.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.importedTransaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId_externalId: {
            connectionId: 'conn-1',
            externalId: 'OFF-ABC',
          },
        },
        create: expect.objectContaining({ buildingId: 'building-1' }),
      }),
    );
    expect(prisma.bankConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { lastSyncedAt: expect.any(Date) },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'openbanking.sync',
        metadata: expect.objectContaining({ high: 1, medium: 0, low: 0 }),
      }),
    );
  });

  it('is idempotent on re-sync — no fresh ids means newCount 0', async () => {
    const txs = [rawTx(), rawTx({ externalId: 'OFF-DEF' })];
    const adapter: BankFeedAdapter = {
      listTransactions: jest.fn().mockResolvedValue(txs),
    };
    const { prisma, service } = syncSetup(adapter);
    prisma.importedTransaction.findMany.mockResolvedValue(
      txs.map((tx) => ({ externalId: tx.externalId })),
    );

    await expect(service.sync('conn-1', user)).resolves.toEqual({
      newCount: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
    expect(prisma.importedTransaction.upsert).toHaveBeenCalledTimes(2);
  });

  it('uses the lastSyncedAt day as the next window start', async () => {
    const adapter: BankFeedAdapter = {
      listTransactions: jest.fn().mockResolvedValue([]),
    };
    const prisma = makePrisma();
    prisma.bankConnection.findFirst.mockResolvedValue({
      ...connection,
      lastSyncedAt: new Date('2026-08-15T18:30:00.000Z'),
    });
    const { service } = setup(prisma, adapter);

    await service.sync('conn-1', user);

    expect(adapter.listTransactions).toHaveBeenCalledWith(
      expect.anything(),
      '2026-08-15',
      expect.any(String),
    );
  });

  it('404s unknown connections or other buildings', async () => {
    const prisma = makePrisma();
    prisma.bankConnection.findFirst.mockResolvedValue(null);
    const { service } = setup(prisma, new OfflineBankFeedAdapter());

    await expect(service.sync('nope', user)).rejects.toThrow(NotFoundException);
  });

  it('propagates feed failures', async () => {
    const adapter: BankFeedAdapter = {
      listTransactions: jest.fn().mockRejectedValue(new Error('feed down')),
    };
    const { service } = syncSetup(adapter);
    await expect(service.sync('conn-1', user)).rejects.toThrow('feed down');
  });
});

describe('OpenBankingService.listTransactions', () => {
  it('annotates credits with suggested match confidence', async () => {
    const prisma = makePrisma();
    prisma.importedTransaction.findMany.mockResolvedValue([
      {
        id: 'stored-1',
        connectionId: 'conn-1',
        externalId: 'OFF-1',
        bookedAt: new Date(Date.parse('2026-08-20T12:00:00Z')),
        amountCents: 12_400,
        remittanceInfo: 'ΣΥΝΔΡΟΜΗ Α1',
      },
      {
        id: 'stored-2',
        connectionId: 'conn-1',
        externalId: 'OFF-2',
        bookedAt: new Date(Date.parse('2026-08-21T12:00:00Z')),
        amountCents: 7_000,
        remittanceInfo: 'ΚΑΤΙ ΑΛΛΟ',
      },
      {
        id: 'stored-3',
        connectionId: 'conn-1',
        externalId: 'OFF-DEBIT',
        bookedAt: new Date(Date.parse('2026-08-22T12:00:00Z')),
        amountCents: -3_000,
        remittanceInfo: 'ΔΕΗ ΚΟΙΝΟΧΡΗΣΤΑ',
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        amountCents: 12_400,
        createdAt: new Date('2026-08-19T09:00:00.000Z'),
        invoice: { periodYearMonth: '2026-08', unit: { label: 'Α1' } },
      },
    ]);
    const { service } = setup(prisma, new OfflineBankFeedAdapter());

    await expect(service.listTransactions('conn-1', user)).resolves.toEqual([
      expect.objectContaining({ id: 'stored-1', suggestionConfidence: 'high' }),
      expect.objectContaining({ id: 'stored-2', suggestionConfidence: null }),
      expect.objectContaining({ id: 'stored-3', suggestionConfidence: null }),
    ]);
  });
});

describe('OpenBankingService.deleteConnection', () => {
  it('deletes and audits; imported rows cascade at FK level', async () => {
    const prisma = makePrisma();
    const { service, audit } = setup(prisma, new OfflineBankFeedAdapter());

    await expect(
      service.deleteConnection('conn-1', user),
    ).resolves.toBeUndefined();
    expect(prisma.bankConnection.delete).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'openbanking.connection.delete' }),
    );
  });
});
