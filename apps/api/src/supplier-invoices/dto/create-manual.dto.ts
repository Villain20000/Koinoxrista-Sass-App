import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

export class CreateManualSupplierInvoiceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  issuerName!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{9}$/, { message: 'issuerAfm must be 9 digits' })
  issuerAfm?: string;

  @IsString()
  @IsISO8601({}, { message: 'issueDate must be ISO8601 date' })
  issueDate!: string;

  @IsInt()
  @Min(0)
  netCents!: number;

  @IsInt()
  @Min(0)
  vatCents!: number;

  @IsInt()
  @Min(1)
  totalCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  classification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  pdfUrl?: string;
}
