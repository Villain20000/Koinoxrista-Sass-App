import { IsString } from 'class-validator';

/** Matches the shared `GenerateRecurringDto` shape for request validation. */
export class GenerateRecurringDto {
  @IsString()
  periodYearMonth!: string;
}
