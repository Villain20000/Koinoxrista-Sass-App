import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWorkLogDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  note!: string;
}
