import {
  IsISO8601,
  IsInt,
  IsEnum,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { SupplierPaymentMethod } from '@prisma/client';

/** Partial update of a supplier payment (tenancy checked in the service). */
export class UpdateSupplierPaymentDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsEnum(SupplierPaymentMethod)
  method?: SupplierPaymentMethod;

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @IsOptional()
  @IsString()
  jobId?: string | null;

  @IsOptional()
  @IsString()
  expenseId?: string | null;

  @IsOptional()
  @IsString()
  reference?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
