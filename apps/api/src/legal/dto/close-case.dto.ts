import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
