import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AllocationStrategy, ChargePayer } from '@prisma/client';

export class CreateExpenseCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsEnum(AllocationStrategy)
  strategy?: AllocationStrategy;

  @IsOptional()
  @IsEnum(ChargePayer)
  defaultChargeTo?: ChargePayer;
}
