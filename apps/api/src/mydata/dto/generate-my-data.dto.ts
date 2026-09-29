import { IsString } from 'class-validator';

export class GenerateMyDataDto {
  @IsString()
  periodYearMonth!: string;
}
