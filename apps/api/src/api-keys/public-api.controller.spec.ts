import { Reflector } from '@nestjs/core';

import { PrismaService } from '../prisma/prisma.service';
import { PublicApiController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { API_KEY_SCOPE_KEY } from './decorators/current-api-key.decorator';

const keyFor = (buildingId: string) => ({
  id: 'key-1',
  buildingId,
  userId: 'user-1',
  name: 'CI key',
  scopes: ['invoices:read', 'payments:read', 'votes:read'],
});

describe('PublicApiController', () => {
  let prisma: { invoice: { findMany: jest.Mock }; vote: { findMany: jest.Mock } };
  let controller: PublicApiController;

  beforeEach(() => {
    prisma = {
      invoice: { findMany: jest.fn().mockResolvedValue([]) },
      vote: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new PublicApiService(prisma as unknown as PrismaService);
    controller = new PublicApiController(service);
  });

  it('serves invoices scoped to the key building (tenant isolation)', async () => {
    await controller.invoices('2026-07', keyFor('building-A'));

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { buildingId: 'building-A', periodYearMonth: '2026-07' },
      }),
    );
  });

  it('ignores the caller-supplied building — the key decides tenancy', async () => {
    await controller.paymentsSummary(keyFor('building-B'));
    await controller.voteResults(keyFor('building-B'));

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { buildingId: 'building-B' } }),
    );
    expect(prisma.vote.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ buildingId: 'building-B' }) }),
    );
  });

  it('declares an apiKeyScope per route', () => {
    const reflector = new Reflector();
    const proto = PublicApiController.prototype;

    for (const [handler, expected] of [
      [proto.invoices, 'invoices:read'],
      [proto.paymentsSummary, 'payments:read'],
      [proto.voteResults, 'votes:read'],
    ] as Array<[() => unknown, string]>) {
      const scope = reflector.get<string>(API_KEY_SCOPE_KEY, handler);
      expect(scope).toBe(expected);
    }
  });
});
