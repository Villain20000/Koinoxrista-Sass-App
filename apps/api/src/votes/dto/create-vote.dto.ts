import { IsISO8601, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateVoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  topic!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsIn(['SIMPLE_MAJORITY', 'MILLIMES_MAJORITY', 'HEADCOUNT'])
  thresholdType!: 'SIMPLE_MAJORITY' | 'MILLIMES_MAJORITY' | 'HEADCOUNT';

  @IsOptional()
  @IsISO8601()
  opensAt?: string;

  @IsISO8601()
  closesAt!: string;
}
