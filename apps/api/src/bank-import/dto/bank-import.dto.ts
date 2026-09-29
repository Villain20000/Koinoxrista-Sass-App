import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const BANK_CSV_MAX_LENGTH = 500_000;
export const BANK_IMPORT_MAX_MATCHES = 1000;

export class PreviewBankCsvDto {
  @IsString()
  @MaxLength(BANK_CSV_MAX_LENGTH)
  csv!: string;
}

export class BankImportMatchDto {
  @IsInt()
  @Min(0)
  rowIndex!: number;

  @IsString()
  @IsNotEmpty()
  paymentId!: string;
}

export class ApplyBankImportDto {
  @IsString()
  @MaxLength(BANK_CSV_MAX_LENGTH)
  csv!: string;

  @IsArray()
  @ArrayMaxSize(BANK_IMPORT_MAX_MATCHES)
  @ValidateNested({ each: true })
  @Type(() => BankImportMatchDto)
  matches!: BankImportMatchDto[];
}
