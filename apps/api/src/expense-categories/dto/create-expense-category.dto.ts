import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AllocationStrategy } from '@prisma/client';

export class CreateExpenseCategoryDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsEnum(AllocationStrategy)
  strategy?: AllocationStrategy;
}
