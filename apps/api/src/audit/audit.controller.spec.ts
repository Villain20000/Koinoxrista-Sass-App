import { Role } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditController, AuditListQueryDto } from './audit.controller';
import { AuditService } from './audit.service';

const admin = () => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
});

function makePrisma() {
  const rows = [{ id: 'audit-1', action: 'expense.created' }];
  return {
    auditLog: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (ops: Promise<unknown>[]) =>
        Promise.all(ops),
      ),
  };
}

function makeController() {
  const prisma = makePrisma();
  const service = new AuditService(prisma as unknown as PrismaService);
  const controller = new AuditController(service);
  return { controller, prisma };
}

describe('AuditController', () => {
  it('scopes to the caller building and maps filters + pagination', async () => {
    const { controller, prisma } = makeController();

    const result = await controller.list(
      {
        action: 'expense.created',
        entity: 'expense',
        entityId: 'exp-1',
        fromISO: '2026-08-01T00:00:00.000Z',
        toISO: '2026-08-31T23:59:59.999Z',
        skip: 25,
        take: 50,
      },
      admin(),
    );

    expect(result).toEqual({
      items: [{ id: 'audit-1', action: 'expense.created' }],
      total: 1,
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        buildingId: 'building-1',
        action: 'expense.created',
        entity: 'expense',
        entityId: 'exp-1',
        createdAt: {
          gte: new Date('2026-08-01T00:00:00.000Z'),
          lte: new Date('2026-08-31T23:59:59.999Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: 25,
      take: 50,
    });
    expect(prisma.auditLog.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ buildingId: 'building-1' }),
    });
  });

  it('applies defaults and clamps take into 1..100', async () => {
    const { controller, prisma } = makeController();

    await controller.list({}, admin());
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 0, take: 25 }),
    );

    await controller.list({ take: 500 }, admin());
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 100 }),
    );

    await controller.list({ take: 0 }, admin());
    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 1 }),
    );
  });

  it('omits the createdAt filter when no date bounds are given', async () => {
    const { controller, prisma } = makeController();

    await controller.list({ action: 'vote.ballot' }, admin());

    const { where } = prisma.auditLog.findMany.mock.calls[0][0];
    expect(where).toEqual({
      buildingId: 'building-1',
      action: 'vote.ballot',
    });
    expect('createdAt' in where).toBe(false);
  });

  it('returns an empty page without querying when the user has no building', async () => {
    const { controller, prisma } = makeController();

    const result = await controller.list(
      {},
      { ...admin(), buildingId: null },
    );

    expect(result).toEqual({ items: [], total: 0 });
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.count).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps the DTO shape aligned with the service filters (query parsing contract)', async () => {
    const dto = new AuditListQueryDto();
    dto.action = 'invoice.run';
    dto.entity = 'invoice';
    dto.take = 10;
    dto.skip = 5;

    const { controller, prisma } = makeController();
    await controller.list(dto, admin());

    expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { buildingId: 'building-1', action: 'invoice.run', entity: 'invoice' },
        skip: 5,
        take: 10,
      }),
    );
  });
});
