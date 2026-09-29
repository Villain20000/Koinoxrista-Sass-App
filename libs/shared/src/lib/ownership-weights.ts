/**
 * Ownership weight basis (P0-3, docs/INTERNATIONAL_PLAN §5). Greece votes and
 * allocates by millimes (‰ of 1000, N.1221/1981). International buildings may
 * weight by ownership share (NA HOA, `shareFraction` ‰) or by usable area
 * (EU/NA, `squareMeters`). The chosen basis must be consistent across all
 * units of a building, so callers derive it once from the full unit list.
 */

export type OwnershipWeightBasis = 'MILLIMES' | 'SHARE_FRACTION' | 'SQUARE_METERS';

export interface WeightedUnit {
  millimes: number;
  squareMeters?: number | null;
  shareFraction?: number | null;
}

export const DEFAULT_OWNERSHIP_BASIS: OwnershipWeightBasis = 'MILLIMES';

/**
 * Picks the ownership-weight basis for a building from its full unit list:
 * - any `shareFraction > 0` → SHARE_FRACTION (NA HOA convention)
 * - else any `squareMeters > 0` → SQUARE_METERS (EU/NA convention)
 * - else MILLIMES (Greek default)
 */
export function resolveOwnershipBasis(units: WeightedUnit[]): OwnershipWeightBasis {
  if (units.some((u) => (u.shareFraction ?? 0) > 0)) return 'SHARE_FRACTION';
  if (units.some((u) => (u.squareMeters ?? 0) > 0)) return 'SQUARE_METERS';
  return DEFAULT_OWNERSHIP_BASIS;
}

/**
 * Integer weight of a single unit under a given basis. Square meters are
 * scaled ×100 to integer hundredths so the largest-remainder split engine
 * (which requires integer weights) stays exact.
 */
export function unitOwnershipWeight(
  unit: WeightedUnit,
  basis: OwnershipWeightBasis = DEFAULT_OWNERSHIP_BASIS,
): number {
  switch (basis) {
    case 'SHARE_FRACTION':
      return unit.shareFraction ?? 0;
    case 'SQUARE_METERS':
      return Math.round((unit.squareMeters ?? 0) * 100);
    default:
      return unit.millimes;
  }
}

/** Total ownership weight of a building under a basis (integer). */
export function totalOwnershipWeight(
  units: WeightedUnit[],
  basis: OwnershipWeightBasis = DEFAULT_OWNERSHIP_BASIS,
): number {
  return units.reduce((sum, unit) => sum + unitOwnershipWeight(unit, basis), 0);
}