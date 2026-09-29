import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** Matches the shared `CreatePaymentPlanDto` shape for request validation. */
export class CreatePaymentPlanDto {
  @IsString()
  unitId!: string;

  /** Plan total in cents; omitted = the unit's current invoice arrears. */
  @IsOptional()
  @IsInt()
  @Min(1)
  totalCents?: number;

  @IsInt()
  @Min(2)
  @Max(24)
  installmentCount!: number;

  @IsISO8601()
  firstDueDate!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalDays?: number;
}
