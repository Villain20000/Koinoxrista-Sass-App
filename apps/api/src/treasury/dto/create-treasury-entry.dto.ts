import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTreasuryEntryDto {
  @IsString()
  accountId!: string;

  @IsInt()
  amountCents!: number;

  @IsString()
  @IsIn(['IN', 'OUT'])
  direction!: string;

  @IsString()
  @IsIn(['CASH', 'BANK', 'CHECK', 'CARD'])
  method!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  receiptUrl?: string;
}
