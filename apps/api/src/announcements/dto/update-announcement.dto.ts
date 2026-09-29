import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { ANNOUNCEMENT_AUDIENCES } from './create-announcement.dto';

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_AUDIENCES)
  audience?: string;
}
