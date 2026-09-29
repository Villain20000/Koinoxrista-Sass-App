import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Template allocation is restricted to these two strategies. */
const RECURRING_STRATEGIES = ['MILIMES', 'UNITS'] as const;

export class CreateRecurringExpenseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsIn(RECURRING_STRATEGIES)
  strategy!: (typeof RECURRING_STRATEGIES)[number];

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
