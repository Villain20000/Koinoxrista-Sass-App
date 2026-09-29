import { IsInt, Min } from 'class-validator';

/** Matches the shared `PlanPaymentDto` shape for request validation. */
export class RecordPlanPaymentDto {
  @IsInt()
  @Min(1)
  amountCents!: number;
}
