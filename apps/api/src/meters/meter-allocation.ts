import { BadRequestException } from '@nestjs/common';

import { splitByLargestRemainder } from '../prisma/split-by-largest-remainder';

/**
 * String literal (instead of the Prisma enum member) so this module compiles
 * before the integrator appends METERS to `enum AllocationStrategy`.
 */
export const METERS_STRATEGY = 'METERS' as const;

/** Kinds of individual consumption meters (mirrors @org/shared METER_KINDS). */
export const METER_KINDS = ['WATER', 'HEAT'] as const;

export type MeterKind = (typeof METER_KINDS)[number];

export function isMetersStrategy(strategy: string): boolean {
  return strategy === METERS_STRATEGY;
}

export interface MeterConsumptionInput {
  unitId: string;
  consumed: number;
}

export interface MeterShareResult {
  unitId: string;
  amountCents: number;
}

/**
 * Documented rule of the METERS strategy: every unit of the building must
 * have at least one meter reading for the expense period. Units without any
 * reading are a validation error listing the missing units — they never fall
 * back to millimes and are not treated as zero consumers.
 */
export function validateAllUnitsHaveReadings(
  unitIds: string[],
  readings: Array<{ unitId: string }>,
): void {
  const withReadings = new Set(readings.map((reading) => reading.unitId));
  const missing = unitIds.filter((unitId) => !withReadings.has(unitId));
  if (missing.length > 0) {
    throw new BadRequestException(
      `METERS strategy requires a reading for every unit; units missing readings: ${missing.join(', ')}`,
    );
  }
}

/**
 * Splits `totalCents` proportionally to each unit's consumed amount using the
 * SAME largest-remainder algorithm as the other strategies (delegates to
 * splitByLargestRemainder), so Σ shares = totalCents exactly in integer cents
 * and remainder cents go to the largest fractional parts (ties broken by
 * input order). Units with consumed = 0 receive 0 cents but still appear in
 * the output (mirrors ground-floor units under ELEVATOR_FLOORS).
 */
export function splitByMeterReading(
  totalCents: number,
  readings: MeterConsumptionInput[],
): MeterShareResult[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new Error('totalCents must be a non-negative integer');
  }
  if (readings.length === 0) {
    return [];
  }
  for (const reading of readings) {
    if (!Number.isInteger(reading.consumed) || reading.consumed < 0) {
      throw new Error('consumed must be non-negative integers');
    }
  }
  const totalConsumed = readings.reduce(
    (sum, reading) => sum + reading.consumed,
    0,
  );
  if (totalConsumed <= 0) {
    throw new BadRequestException(
      'METERS strategy requires at least one unit with consumption > 0',
    );
  }
  return splitByLargestRemainder(
    totalCents,
    readings.map((reading) => ({ id: reading.unitId, weight: reading.consumed })),
  ).map((split) => ({ unitId: split.id, amountCents: split.amountCents }));
}
