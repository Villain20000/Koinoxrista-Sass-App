import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateAgendaItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  /** Reorder target (1-based); must stay within the vote's agenda bounds. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  position?: number;
}
