import { ChargePayer } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

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

  /** Ένοικος (OCCUPANT) or ιδιοκτήτης (OWNER); defaults to the category default. */
  @IsOptional()
  @IsEnum(ChargePayer)
  chargeTo?: ChargePayer;
}
