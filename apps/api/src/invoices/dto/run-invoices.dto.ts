import { IsString } from 'class-validator';

export class RunInvoicesDto {
  @IsString()
  periodYearMonth!: string;
}
