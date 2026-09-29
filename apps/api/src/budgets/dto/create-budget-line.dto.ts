import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

const CURRENT_YEAR = new Date().getFullYear();

export const MIN_BUDGET_YEAR = CURRENT_YEAR - 5;
export const MAX_BUDGET_YEAR = CURRENT_YEAR + 5;

export class CreateBudgetLineDto {
  @IsInt()
  @Min(MIN_BUDGET_YEAR)
  @Max(MAX_BUDGET_YEAR)
  year!: number;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsInt()
  @Min(0)
  plannedCents!: number;

  @IsOptional()
  @IsString()
  categoryId?: string;
}
