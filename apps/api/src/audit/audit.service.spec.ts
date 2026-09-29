import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

function makePrisma() {
  return {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('AuditService', () => {
  let service: AuditService;
  let prisma: ReturnType<typeof makePrisma>;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = makePrisma();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    service = new AuditService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('writes the expected append-only payload with hash chaining', async () => {
    service.record({
      buildingId: 'building-1',
      actorId: 'user-1',
      actorRole: 'ADMIN',
      action: 'expense.created',
      entity: 'expense',
      entityId: 'expense-1',
      metadata: { totalCents: 10_000 },
      ip: '203.0.113.9',
    });

    // audit write is fire-and-forget async (hash + findFirst), so wait a tick
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.auditLog.create.mock.calls[0][0];
    expect(data.buildingId).toBe('building-1');
    expect(data.action).toBe('expense.created');
    expect(data.metadata).toMatchObject({ totalCents: 10_000 });
    expect(data.metadata).toHaveProperty('_hash');
    expect(data.metadata).toHaveProperty('_prev');
    expect(data.metadata).toHaveProperty('_chain', 1);
    expect(typeof (data.metadata as Record<string, unknown>)._hash).toBe('string');
  });

  it('omits metadata when absent and defaults optional fields to null/undefined-free payload (with chain)', async () => {
    service.record({
      buildingId: null,
      action: 'payment.webhook',
      entity: 'paymentOrder',
      entityId: 'order-1',
    });

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));

    const { data } = prisma.auditLog.create.mock.calls[0][0];
    expect(data.buildingId).toBe(null);
    expect(data.action).toBe('payment.webhook');
    expect(data.metadata).toHaveProperty('_hash');
    expect(data.metadata).toHaveProperty('_prev');
  });

  it('never throws and only warns when the write is rejected', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));

    expect(() =>
      service.record({
        action: 'vote.ballot',
        entity: 'ballot',
      }),
    ).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[audit] write failed for vote.ballot:'),
      expect.any(Error),
    );
  });
});
