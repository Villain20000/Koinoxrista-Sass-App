import { IsString } from 'class-validator';

/** Matches the shared `GenerateMyDataDto` shape for request validation. */
export class ReconcileMyDataDto {
  @IsString()
  periodYearMonth!: string;
}
