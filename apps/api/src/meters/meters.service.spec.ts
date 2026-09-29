import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { MetersService } from './meters.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const auditStub = (): AuditService =>
  ({ record: jest.fn() }) as unknown as AuditService;

const user = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN' as AuthenticatedUser['role'],
  buildingId: 'building-1',
  ...overrides,
});

type MeterRow = { id: string; buildingId: string; unitId: string; kind: string };

function makePrisma() {
  const meters: MeterRow[] = [
    { id: 'meter-w1', buildingId: 'building-1', unitId: 'unit-a', kind: 'WATER' },
  ];

  const prisma = {
    building: { findUnique: jest.fn().mockResolvedValue({ id: 'building-1' }) },
    unit: {
      findFirst: jest.fn().mockResolvedValue({ id: 'unit-a' }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'unit-a', label: 'Α1' },
        { id: 'unit-b', label: 'Β1' },
      ]),
    },
    meter: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        meters.find((m) => m.id === where.id) ?? null,
      ),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'meter-new', unitId: 'unit-a', kind: 'HEAT' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    meterReading: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'reading-1', meterId: 'meter-w1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  return { prisma, meters };
}

describe('MetersService', () => {
  let service: MetersService;
  let prisma: ReturnType<typeof makePrisma>['prisma'];

  beforeEach(() => {
    prisma = makePrisma().prisma;
    service = new MetersService(
      prisma as unknown as PrismaService,
      auditStub(),
    );
  });

  it('enforces tenant scope on list and consumption', async () => {
    await expect(
      service.list('building-2', user()),
    ).rejects.toThrow(/Access to another building/);
    await expect(
      service.consumption('building-2', '2026-08', undefined, user()),
    ).rejects.toThrow(/Access to another building/);
  });

  it('registers a meter for a unit of the building and audits it', async () => {
    const meter = await service.create(
      'building-1',
      { unitId: 'unit-a', kind: 'HEAT' },
      user(),
    );

    expect(prisma.unit.findFirst).toHaveBeenCalledWith({
      where: { id: 'unit-a', buildingId: 'building-1' },
      select: { id: true },
    });
    expect(meter).toEqual({ id: 'meter-new', unitId: 'unit-a', kind: 'HEAT' });
  });

  it('rejects registering a meter for a foreign unit', async () => {
    prisma.unit.findFirst.mockResolvedValue(null);

    await expect(
      service.create('building-1', { unitId: 'unit-x', kind: 'WATER' }, user()),
    ).rejects.toThrow(
      new BadRequestException('Unit does not belong to this building'),
    );
    expect(prisma.meter.create).not.toHaveBeenCalled();
  });

  it('maps the unique-constraint violation to a conflict error', async () => {
    prisma.meter.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.create('building-1', { unitId: 'unit-a', kind: 'WATER' }, user()),
    ).rejects.toThrow(ConflictException);
  });

  it('deletes only meters of the same building and cascades readings', async () => {
    await service.remove('meter-w1', user());
    expect(prisma.meter.delete).toHaveBeenCalledWith({
      where: { id: 'meter-w1' },
    });

    prisma.meter.findUnique.mockResolvedValue({
      id: 'meter-foreign',
      buildingId: 'building-9',
      unitId: 'unit-x',
      kind: 'WATER',
    });
    await expect(service.remove('meter-foreign', user())).rejects.toThrow(
      /Access to another building/,
    );
    expect(prisma.meter.delete).toHaveBeenCalledTimes(1);

    prisma.meter.findUnique.mockResolvedValue(null);
    await expect(service.remove('missing', user())).rejects.toThrow(
      new NotFoundException('Meter not found'),
    );
  });

  it('upserts one reading per meter and period, validating period and value', async () => {
    await service.upsertReading(
      'meter-w1',
      { period: '2026-08', value: 4200 },
      user(),
    );
    expect(prisma.meterReading.upsert).toHaveBeenCalledWith({
      where: {
        meterId_period: { meterId: 'meter-w1', period: '2026-08' },
      },
      create: { meterId: 'meter-w1', period: '2026-08', value: 4200 },
      update: { value: 4200 },
    });

    await expect(
      service.upsertReading(
        'meter-w1',
        { period: '08-2026', value: 10 },
        user(),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertReading(
        'meter-w1',
        { period: '2026-08', value: -3 },
        user(),
      ),
    ).rejects.toThrow(
      new BadRequestException('value must be a non-negative integer'),
    );

    prisma.meter.findUnique.mockResolvedValue(null);
    await expect(
      service.upsertReading('missing', { period: '2026-08', value: 1 }, user()),
    ).rejects.toThrow(new NotFoundException('Meter not found'));
  });

  it('builds the readings matrix rows per unit and kind with nulls', async () => {
    prisma.meter.findMany.mockResolvedValue([
      {
        id: 'meter-w1',
        unitId: 'unit-a',
        kind: 'WATER',
        label: null,
        readings: [{ value: 4200, readAt: new Date('2026-08-31T10:00:00Z') }],
      },
      {
        id: 'meter-h1',
        unitId: 'unit-a',
        kind: 'HEAT',
        label: null,
        readings: [],
      },
    ]);

    const matrix = await service.readingsMatrix('building-1', '2026-08', user());

    expect(matrix.period).toBe('2026-08');
    expect(matrix.kinds).toEqual(['WATER', 'HEAT']);
    expect(matrix.rows).toEqual([
      {
        unitId: 'unit-a',
        unitLabel: 'Α1',
        cells: {
          WATER: {
            meterId: 'meter-w1',
            label: null,
            value: 4200,
            readAt: '2026-08-31T10:00:00.000Z',
          },
          HEAT: {
            meterId: 'meter-h1',
            label: null,
            value: null,
            readAt: undefined,
          },
        },
      },
      { unitId: 'unit-b', unitLabel: 'Β1', cells: {} },
    ]);
  });

  it('rejects an invalid or missing matrix period', async () => {
    await expect(
      service.readingsMatrix('building-1', undefined, user()),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.readingsMatrix('building-1', '2026-13', user()),
    ).rejects.toThrow(BadRequestException);
  });

  it('sums consumption across a unit’s meters and flags units without readings', async () => {
    prisma.meterReading.findMany.mockResolvedValue([
      { value: 4200, meter: { unitId: 'unit-a' } },
      { value: 800, meter: { unitId: 'unit-a' } },
      { value: 1500, meter: { unitId: 'unit-b' } },
    ]);

    const consumptions = await service.consumption(
      'building-1',
      '2026-08',
      undefined,
      user(),
    );

    expect(consumptions).toEqual([
      { unitId: 'unit-a', unitLabel: 'Α1', consumed: 5000, hasReadings: true },
      { unitId: 'unit-b', unitLabel: 'Β1', consumed: 1500, hasReadings: true },
    ]);

    prisma.meterReading.findMany.mockResolvedValue([]);
    const empty = await service.consumption(
      'building-1',
      '2026-08',
      undefined,
      user(),
    );
    expect(empty).toEqual([
      { unitId: 'unit-a', unitLabel: 'Α1', consumed: 0, hasReadings: false },
      { unitId: 'unit-b', unitLabel: 'Β1', consumed: 0, hasReadings: false },
    ]);
  });

  it('filters consumption by kind and rejects unknown kinds', async () => {
    await service.consumption('building-1', '2026-08', 'WATER', user());
    expect(prisma.meterReading.findMany).toHaveBeenCalledWith({
      where: {
        period: '2026-08',
        meter: { buildingId: 'building-1', kind: 'WATER' },
      },
      select: { value: true, meter: { select: { unitId: true } } },
    });

    await expect(
      service.consumption('building-1', '2026-08', 'GAS', user()),
    ).rejects.toThrow(BadRequestException);
  });
});
