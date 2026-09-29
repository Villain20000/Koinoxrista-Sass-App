import { BadRequestException } from '@nestjs/common';
import { AllocationStrategy } from '@prisma/client';

import type { SplitInput } from '../prisma/split-by-largest-remainder';

export interface AllocatableUnit {
  id: string;
  millimes: number;
  floor?: number | null;
  radiatorCount?: number;
  squareMeters?: number | null;
  shareFraction?: number | null;
}

function weightFor(
  unit: AllocatableUnit,
  strategy: AllocationStrategy,
): number {
  switch (strategy) {
    case AllocationStrategy.MILIMES:
      return unit.millimes;
    case AllocationStrategy.UNITS:
      return 1;
    case AllocationStrategy.RADIATORS:
      return unit.radiatorCount ?? 0;
    case AllocationStrategy.ELEVATOR_FLOORS:
      return Math.max(unit.floor ?? 0, 0);
    case AllocationStrategy.SQUARE_METERS:
      // Scale m² → integer hundredths so the integer-weight split stays exact.
      return Math.round((unit.squareMeters ?? 0) * 100);
    case AllocationStrategy.SHARE_FRACTION:
      return unit.shareFraction ?? 0;
    case AllocationStrategy.HEADCOUNT:
      // Per-unit equal weights regardless of ownership basis.
      return 1;
    default:
      throw new BadRequestException('CUSTOM allocation not supported yet');
  }
}

/** Human-readable requirement for zero-total validation (pure). */
function strategyRequirement(strategy: AllocationStrategy): string | null {
  switch (strategy) {
    case AllocationStrategy.RADIATORS:
      return 'radiatorCount > 0';
    case AllocationStrategy.ELEVATOR_FLOORS:
      return 'floor >= 1';
    case AllocationStrategy.SQUARE_METERS:
      return 'squareMeters > 0';
    case AllocationStrategy.SHARE_FRACTION:
      return 'shareFraction > 0';
    default:
      return null;
  }
}

export function resolveAllocationWeights(
  units: AllocatableUnit[],
  strategy: AllocationStrategy,
): SplitInput[] {
  const inputs = units.map((unit) => ({
    id: unit.id,
    weight: weightFor(unit, strategy),
  }));
  const totalWeight = inputs.reduce((sum, input) => sum + input.weight, 0);
  const requirement = strategyRequirement(strategy);
  if (totalWeight <= 0 && requirement) {
    throw new BadRequestException(
      `Category strategy requires at least one unit with ${requirement}`,
    );
  }
  return inputs;
}
