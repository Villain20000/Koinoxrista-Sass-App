import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

import { LEAD_STATUS_VALUES } from '../pipeline';

export class LeadStatusDto {
  @IsIn(LEAD_STATUS_VALUES as readonly string[])
  status!: string;

  /** Required (≥ 0) when `status` is WON: realized commission in cents. */
  @IsOptional()
  @IsInt()
  @Min(0)
  actualCommissionCents?: number;
}
