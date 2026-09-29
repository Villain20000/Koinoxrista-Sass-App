import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class DrawdownDto {
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  expenseId?: string;
}
