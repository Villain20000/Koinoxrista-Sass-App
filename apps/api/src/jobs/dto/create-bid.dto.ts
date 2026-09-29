import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateBidDto {
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
