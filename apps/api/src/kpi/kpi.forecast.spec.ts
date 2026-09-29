import { KpiService } from './kpi.service';

function makePrisma(invoices: any[], units: any[]) {
  return {
    invoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    unit: { findMany: jest.fn().mockResolvedValue(units) },
    buildingWeeklySnapshot: { findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    alertRule: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    job: { count: jest.fn().mockResolvedValue(0) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const user = { id: 'u1', buildingId: 'b1', role: 'ADMIN' } as any;

describe('KpiService.forecastArrears (local tabular model)', () => {
  it('ranks overdue units highest', async () => {
    const invoices = [
      { unitId: 'uA', totalCents: 10000, paidCents: 0, unit: { label: 'A1' } },
      { unitId: 'uA', totalCents: 10000, paidCents: 0, unit: { label: 'A1' } },
      { unitId: 'uB', totalCents: 10000, paidCents: 10000, unit: { label: 'B1' } },
      { unitId: 'uB', totalCents: 10000, paidCents: 10000, unit: { label: 'B1' } },
    ];
    const units = [{ id: 'uA', label: 'A1' }, { id: 'uB', label: 'B1' }];
    const prisma = makePrisma(invoices, units);
    const svc = new KpiService(prisma as any, { record: jest.fn() } as any, { create: jest.fn() } as any);
    const res = await svc.forecastArrears('b1', user);
    expect(res.units[0].unitId).toBe('uA');
    expect(res.units[0].risk).toBeGreaterThan(res.units[1].risk);
    expect(res.units[0].overdueCents).toBe(20000);
    expect(res.units[1].risk).toBe(0);
  });

  it('handles building with no invoices (all risk 0)', async () => {
    const prisma = makePrisma([], [{ id: 'u1', label: 'A1' }]);
    const svc = new KpiService(prisma as any, { record: jest.fn() } as any, { create: jest.fn() } as any);
    const res = await svc.forecastArrears('b1', user);
    expect(res.units).toHaveLength(1);
    expect(res.units[0].risk).toBe(0);
    expect(res.units[0].totalCents).toBe(0);
  });

  it('enforces tenant isolation via assertSameBuilding', async () => {
    const prisma = makePrisma([], []);
    const svc = new KpiService(prisma as any, { record: jest.fn() } as any, { create: jest.fn() } as any);
    const otherUser = { id: 'u2', buildingId: 'other', role: 'ADMIN' } as any;
    await expect(svc.forecastArrears('b1', otherUser)).rejects.toThrow();
  });
});
