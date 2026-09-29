import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const RESERVE_CONTRIBUTION_SOURCES = ['MANUAL', 'LEVY', 'INTEREST'] as const;
export type ReserveContributionSource = (typeof RESERVE_CONTRIBUTION_SOURCES)[number];

export class ContributionDto {
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsString()
  @IsIn([...RESERVE_CONTRIBUTION_SOURCES])
  source!: ReserveContributionSource;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  levyId?: string;
}
