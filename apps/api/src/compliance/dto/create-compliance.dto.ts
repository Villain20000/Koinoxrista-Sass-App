import { ComplianceKind } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateComplianceDto {
  @IsEnum(ComplianceKind)
  kind!: ComplianceKind;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  providerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  policyNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  premiumCents?: number;

  @IsISO8601()
  startsOn!: string;

  @IsISO8601()
  endsOn!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
