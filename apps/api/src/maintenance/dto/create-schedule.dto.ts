import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateScheduleDto {
  @IsString()
  @MinLength(1)
  assetId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @IsInt()
  @Min(1)
  intervalMonths!: number;

  @IsOptional()
  @IsISO8601()
  lastDoneAt?: string;

  @IsOptional()
  @IsBoolean()
  autoCreateJob?: boolean;

  @IsOptional()
  @IsString()
  expenseCategoryId?: string;
}
