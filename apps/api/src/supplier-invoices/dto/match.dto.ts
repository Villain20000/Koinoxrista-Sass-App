import { IsOptional, IsString, IsUUID } from 'class-validator';

export class MatchSupplierInvoiceDto {
  @IsOptional()
  @IsString()
  @IsUUID()
  expenseId?: string;
}
