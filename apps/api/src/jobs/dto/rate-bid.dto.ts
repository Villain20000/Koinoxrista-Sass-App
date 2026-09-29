import { IsInt, Max, Min } from 'class-validator';

export class RateBidDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;
}
