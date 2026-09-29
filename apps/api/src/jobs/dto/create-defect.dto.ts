import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDefectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description!: string;
}
