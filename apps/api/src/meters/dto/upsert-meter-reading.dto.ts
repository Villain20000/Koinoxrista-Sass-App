import { IsInt, IsString, Min } from 'class-validator';

export class UpsertMeterReadingDto {
  /** Billing period the reading belongs to (`YYYY-MM`); upserted per period. */
  @IsString()
  period!: string;

  /** Integer consumption for the period: liters (WATER) or Wh (HEAT). */
  @IsInt()
  @Min(0)
  value!: number;
}
