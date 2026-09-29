import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAgendaItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;
}
