import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const ASSET_CATEGORIES = [
  'ELEVATOR',
  'BOILER',
  'FIRE_EXT',
  'PUMP',
  'ROOF',
  'OTHER',
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export class CreateAssetDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(ASSET_CATEGORIES as unknown as string[])
  category!: AssetCategory;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsISO8601()
  installedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
