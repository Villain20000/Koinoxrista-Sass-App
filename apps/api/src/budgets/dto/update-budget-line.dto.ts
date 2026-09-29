import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

import { MAX_BUDGET_YEAR, MIN_BUDGET_YEAR } from './create-budget-line.dto';

export class UpdateBudgetLineDto {
  @IsOptional()
  @IsInt()
  @Min(MIN_BUDGET_YEAR)
  @Max(MAX_BUDGET_YEAR)
  year?: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  plannedCents?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;
}
