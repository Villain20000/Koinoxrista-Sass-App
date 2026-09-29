import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class SetOccupancyDto {
  @IsString()
  userId!: string;

  @IsIn(['OWNER', 'TENANT'])
  occupantType!: 'OWNER' | 'TENANT';

  @IsOptional()
  @IsBoolean()
  votingEligible?: boolean;

  @IsOptional()
  @IsString()
  residentRole?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  shareMillimes?: number;

  @IsOptional()
  @IsISO8601()
  periodStart?: string;
}
