import {
  IsISO8601,
  IsInt,
  IsEnum,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SupplierPaymentMethod } from '@prisma/client';

/** Matches the shared `CreateSupplierPaymentDto` shape for request validation. */
export class CreateSupplierPaymentDto {
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsEnum(SupplierPaymentMethod)
  method!: SupplierPaymentMethod;

  @IsISO8601()
  paidAt!: string;

  @IsOptional()
  @IsString()
  jobId?: string;

  @IsOptional()
  @IsString()
  expenseId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
