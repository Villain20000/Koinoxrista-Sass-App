import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Loose IBAN shape: 2 letters + 2 check digits + 10–30 alphanumerics. */
export const IBAN_PATTERN = /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,30}$/;

export class CreateBankConnectionDto {
  @IsString()
  @Matches(IBAN_PATTERN, { message: 'iban must be a valid IBAN' })
  iban!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  institutionName?: string;
}
