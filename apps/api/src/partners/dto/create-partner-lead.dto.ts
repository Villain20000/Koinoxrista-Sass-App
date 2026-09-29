import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PARTNER_CATEGORIES } from '@org/shared';

export class CreatePartnerLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  partnerName!: string;

  @IsIn(PARTNER_CATEGORIES as readonly string[])
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsInt()
  @Min(0)
  expectedCommissionCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
