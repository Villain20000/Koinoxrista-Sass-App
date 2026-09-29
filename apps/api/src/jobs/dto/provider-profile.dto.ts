import { IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertProviderProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  trade!: string;

  @IsArray()
  @IsString({ each: true })
  certs!: string[];
}
