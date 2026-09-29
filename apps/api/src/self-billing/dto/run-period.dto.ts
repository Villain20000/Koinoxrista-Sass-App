import { Matches } from 'class-validator';

/** `YYYY-MM` body for the recurring platform-fee issuance endpoint. */
export class RunPeriodDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must match YYYY-MM' })
  period!: string;
}
