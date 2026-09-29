import {
  IsArray,
  ArrayMinSize,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateLegalCaseDto {
  @IsString()
  unitId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  invoiceIds!: string[];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lawyerName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  lawyerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
