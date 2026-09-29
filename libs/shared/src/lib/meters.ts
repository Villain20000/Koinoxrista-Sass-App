/**
 * Individual consumption meters per unit (νερό / θέρμανση).
 * A `Meter` is registered once per (unit, kind); readings are stored per
 * billing period and hold integer consumption values.
 */

/** Kinds of individual consumption meters tracked per unit. */
export const METER_KINDS = ['WATER', 'HEAT'] as const;

export type MeterKind = (typeof METER_KINDS)[number];

export interface MeterDto {
  id: string;
  buildingId: string;
  unitId: string;
  unitLabel?: string;
  kind: MeterKind;
  label?: string | null;
}

export interface CreateMeterDto {
  unitId: string;
  kind: MeterKind;
  label?: string;
}

export interface MeterReadingDto {
  id: string;
  meterId: string;
  /** Billing period the reading belongs to (`YYYY-MM`). */
  period: string;
  /**
   * Integer consumption for the period: liters for WATER meters,
   * watt-hours for HEAT meters.
   */
  value: number;
  readAt?: string;
}

export interface UpsertMeterReadingDto {
  period: string;
  value: number;
}

/** One matrix cell of the readings grid: a unit's value for one kind. */
export interface MeterMatrixCellDto {
  meterId: string;
  label?: string | null;
  value?: number | null;
  readAt?: string;
}

/** Readings-entry grid row: one unit × every meter kind. */
export interface MeterMatrixRowDto {
  unitId: string;
  unitLabel: string;
  cells: Partial<Record<MeterKind, MeterMatrixCellDto>>;
}

export interface MetersReadingsMatrixDto {
  period: string;
  kinds: readonly MeterKind[];
  rows: MeterMatrixRowDto[];
}

/**
 * Per-unit total consumption across its meters for one period. Units without
 * any reading report `consumed: 0` and `hasReadings: false`; the METERS
 * allocation strategy rejects runs where any unit has no reading.
 */
export interface ConsumptionDto {
  unitId: string;
  unitLabel: string;
  consumed: number;
  hasReadings: boolean;
}
