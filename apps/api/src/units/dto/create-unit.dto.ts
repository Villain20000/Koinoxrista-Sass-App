import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUnitDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsInt()
  floor?: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  millimes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  radiatorCount?: number;

  /** P0-3: usable area in m² (SQUARE_METERS strategy). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  squareMeters?: number;

  /** P0-3: ownership share as integer ‰ of 1000 (SHARE_FRACTION strategy). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  shareFraction?: number;
}
