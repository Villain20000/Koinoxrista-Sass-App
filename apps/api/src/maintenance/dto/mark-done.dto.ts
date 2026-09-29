import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MarkDoneDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
