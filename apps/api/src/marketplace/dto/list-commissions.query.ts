import { IsIn, IsOptional } from 'class-validator';
import type { JobCommissionStatus } from '@org/shared';

/** Query filters for listing a building's commissions. */
export class ListCommissionsQueryDto {
  @IsOptional()
  @IsIn(['DUE', 'PAID', 'WAIVED'])
  status?: JobCommissionStatus;
}
