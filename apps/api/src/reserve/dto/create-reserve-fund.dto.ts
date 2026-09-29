import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateReserveFundDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  targetCents?: number;
}

export class UpdateReserveTargetDto {
  @IsInt()
  @Min(0)
  targetCents!: number;
}
