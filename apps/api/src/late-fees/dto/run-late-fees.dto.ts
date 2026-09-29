import { IsOptional, IsString } from 'class-validator';

/** Request body for a late-fee sweep. */
export class RunLateFeesDto {
  /** Restrict the sweep to one invoice month (`YYYY-MM`). Omitted = all months. */
  @IsOptional()
  @IsString()
  month?: string;
}
