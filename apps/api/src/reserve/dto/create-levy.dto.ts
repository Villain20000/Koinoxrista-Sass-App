import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CustomWeightDto {
  @IsString()
  unitId!: string;

  @IsInt()
  @Min(1)
  weight!: number;
}

export class CreateLevyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @IsInt()
  @Min(1)
  totalCents!: number;

  @IsString()
  @IsIn(['MILIMES', 'UNITS', 'CUSTOM', 'SQUARE_METERS', 'SHARE_FRACTION'])
  strategy!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomWeightDto)
  customWeights?: CustomWeightDto[];

  @IsOptional()
  @IsString()
  voteId?: string;
}
