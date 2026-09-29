import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTreasuryAccountDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @IsIn(['CASH', 'BANK'])
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string;
}
