import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Matches the shared `UpdateLateFeeSettingsDto` shape for request validation. */
export class UpdateLateFeeSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  graceDays?: number;

  @IsOptional()
  @IsIn(['FLAT', 'PERCENT'])
  mode?: 'FLAT' | 'PERCENT';

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyFlatCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  dailyBps?: number;

  /** `null` clears an existing cap. */
  @IsOptional()
  @IsInt()
  @Min(0)
  capCents?: number | null;
}
