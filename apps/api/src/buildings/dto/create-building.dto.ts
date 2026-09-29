import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBuildingDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;
}
