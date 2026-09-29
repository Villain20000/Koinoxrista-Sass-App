import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { isValidPeriod } from '@org/shared';

export function assertSameBuilding(
  user: AuthenticatedUser,
  buildingId: string,
): void {
  if (!user.buildingId || user.buildingId !== buildingId) {
    throw new ForbiddenException('Access to another building is not allowed');
  }
}

export function requireValidPeriod(periodYearMonth: string | undefined): string {
  if (!periodYearMonth || !isValidPeriod(periodYearMonth)) {
    throw new BadRequestException('periodYearMonth must match YYYY-MM');
  }
  return periodYearMonth;
}
