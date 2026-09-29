import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateExpenseDto {
  @IsString()
  categoryId!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsInt()
  @Min(1)
  totalCents!: number;

  @IsString()
  periodYearMonth!: string;
}
