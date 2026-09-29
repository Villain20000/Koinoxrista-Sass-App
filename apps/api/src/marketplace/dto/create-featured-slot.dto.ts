import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CreateFeaturedSlotDto as CreateFeaturedSlotInput } from '@org/shared';

/** Request body for creating a featured directory placement. */
export class CreateFeaturedSlotDto implements CreateFeaturedSlotInput {
  @IsString()
  providerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  trade?: string | null;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;
}
