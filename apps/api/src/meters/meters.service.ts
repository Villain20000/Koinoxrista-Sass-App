import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { isValidPeriod } from '@org/shared';
import { assertSameBuilding } from '../common/tenant';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { METER_KINDS } from './meter-allocation';
import { CreateMeterDto } from './dto/create-meter.dto';
import { UpsertMeterReadingDto } from './dto/upsert-meter-reading.dto';

const METER_WITH_UNIT = Prisma.validator<Prisma.MeterInclude>()({
  unit: { select: { label: true } },
});

/**
 * Per-unit consumption for one period, shaped like @org/shared ConsumptionDto.
 * Units without any reading report consumed = 0 and hasReadings = false; the
 * METERS allocation strategy rejects such runs via validateAllUnitsHaveReadings
 * instead of treating missing readings as zero consumption.
 */
export interface UnitConsumption {
  unitId: string;
  unitLabel: string;
  consumed: number;
  hasReadings: boolean;
}

@Injectable()
export class MetersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);

    return this.prisma.meter.findMany({
      where: { buildingId },
      include: METER_WITH_UNIT,
      orderBy: [{ unit: { label: 'asc' } }, { kind: 'asc' }],
    });
  }

  async create(
    buildingId: string,
    dto: CreateMeterDto,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);

    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true },
    });
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    const unit = await this.prisma.unit.findFirst({
      where: { id: dto.unitId, buildingId },
      select: { id: true },
    });
    if (!unit) {
      throw new BadRequestException('Unit does not belong to this building');
    }

    const meter = await this.prisma.meter
      .create({
        data: {
          buildingId,
          unitId: dto.unitId,
          kind: dto.kind,
          ...(dto.label ? { label: dto.label } : {}),
        },
        include: METER_WITH_UNIT,
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'A meter of this kind is already registered for the unit',
          );
        }
        throw error;
      });

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'meter.registered',
      entity: 'meter',
      entityId: meter.id,
      metadata: { unitId: dto.unitId, kind: dto.kind },
    });

    return meter;
  }

  async remove(id: string, user: AuthenticatedUser) {
    const meter = await this.prisma.meter.findUnique({ where: { id } });
    if (!meter) {
      throw new NotFoundException('Meter not found');
    }
    assertSameBuilding(user, meter.buildingId);

    // Readings are removed by the MeterReading.meter FK cascade (fragment).
    await this.prisma.meter.delete({ where: { id } });

    this.audit.record({
      buildingId: meter.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'meter.deleted',
      entity: 'meter',
      entityId: meter.id,
      metadata: { unitId: meter.unitId, kind: meter.kind },
    });
  }

  /**
   * Upserts the reading of one meter for a period (@@unique [meterId, period]).
   */
  async upsertReading(
    meterId: string,
    dto: UpsertMeterReadingDto,
    user: AuthenticatedUser,
  ) {
    const meter = await this.prisma.meter.findUnique({ where: { id: meterId } });
    if (!meter) {
      throw new NotFoundException('Meter not found');
    }
    assertSameBuilding(user, meter.buildingId);
    if (!isValidPeriod(dto.period)) {
      throw new BadRequestException('period must match YYYY-MM');
    }
    if (!Number.isInteger(dto.value) || dto.value < 0) {
      throw new BadRequestException('value must be a non-negative integer');
    }

    const reading = await this.prisma.meterReading.upsert({
      where: {
        meterId_period: { meterId, period: dto.period },
      },
      create: { meterId, period: dto.period, value: dto.value },
      update: { value: dto.value },
    });

    this.audit.record({
      buildingId: meter.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'meter.reading.recorded',
      entity: 'meter-reading',
      entityId: reading.id,
      metadata: { meterId, period: dto.period, value: dto.value },
    });

    return reading;
  }

  /** Matrix view data for the readings-entry grid: units × meter kinds. */
  async readingsMatrix(
    buildingId: string,
    periodYearMonth: string | undefined,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!periodYearMonth || !isValidPeriod(periodYearMonth)) {
      throw new BadRequestException('period must match YYYY-MM');
    }

    const units = await this.prisma.unit.findMany({
      where: { buildingId },
      orderBy: { label: 'asc' },
    });
    const meters = await this.prisma.meter.findMany({
      where: { buildingId },
      include: {
        readings: { where: { period: periodYearMonth } },
      },
      orderBy: [{ unit: { label: 'asc' } }, { kind: 'asc' }],
    });

    const metersByUnit = new Map<string, typeof meters>();
    for (const meter of meters) {
      const list = metersByUnit.get(meter.unitId) ?? [];
      list.push(meter);
      metersByUnit.set(meter.unitId, list);
    }

    const rows = units.map((unit) => ({
      unitId: unit.id,
      unitLabel: unit.label,
      cells: Object.fromEntries(
        (metersByUnit.get(unit.id) ?? []).map((meter) => [
          meter.kind,
          {
            meterId: meter.id,
            label: meter.label,
            value: meter.readings[0]?.value ?? null,
            readAt: meter.readings[0]?.readAt.toISOString(),
          },
        ]),
      ),
    }));

    return { period: periodYearMonth, kinds: METER_KINDS, rows };
  }

  /**
   * Per-unit consumed values used by the METERS strategy and the UI preview
   * bars: a unit's consumption is the sum of its per-meter reading values
   * for the period. Optional `kind` restricts to WATER or HEAT meters only.
   */
  async consumption(
    buildingId: string,
    periodYearMonth: string | undefined,
    kind: string | undefined,
    user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    if (!periodYearMonth || !isValidPeriod(periodYearMonth)) {
      throw new BadRequestException('period must match YYYY-MM');
    }
    return this.buildUnitConsumptions(buildingId, periodYearMonth, kind);
  }

  /**
   * Internal variant without tenant checks — reused by ExpensesService when
   * it splits an expense with the METERS strategy.
   */
  async buildUnitConsumptions(
    buildingId: string,
    periodYearMonth: string,
    kind?: string,
  ): Promise<UnitConsumption[]> {
    if (kind && !METER_KINDS.includes(kind as (typeof METER_KINDS)[number])) {
      throw new BadRequestException(
        `kind must be one of ${METER_KINDS.join(', ')}`,
      );
    }

    const units = await this.prisma.unit.findMany({
      where: { buildingId },
      orderBy: { label: 'asc' },
    });
    const readings = await this.prisma.meterReading.findMany({
      where: {
        period: periodYearMonth,
        meter: {
          buildingId,
          ...(kind ? { kind } : {}),
        },
      },
      select: { value: true, meter: { select: { unitId: true } } },
    });

    const consumedByUnit = new Map<string, number>();
    for (const reading of readings) {
      const unitId = reading.meter.unitId;
      consumedByUnit.set(
        unitId,
        (consumedByUnit.get(unitId) ?? 0) + reading.value,
      );
    }

    return units.map((unit) => ({
      unitId: unit.id,
      unitLabel: unit.label,
      consumed: consumedByUnit.get(unit.id) ?? 0,
      hasReadings: consumedByUnit.has(unit.id),
    }));
  }
}
