import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateOwnershipDto {
  @IsString()
  userId!: string;

  @IsInt()
  @Min(1)
  shareMillimes!: number;

  @IsOptional()
  @IsISO8601()
  periodStart?: string;
}
