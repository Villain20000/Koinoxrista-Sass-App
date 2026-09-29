import { IsString } from 'class-validator';

/** Matches the shared `GenerateMyDataDto` shape for request validation. */
export class GenerateMyDataDto {
  @IsString()
  periodYearMonth!: string;
}
