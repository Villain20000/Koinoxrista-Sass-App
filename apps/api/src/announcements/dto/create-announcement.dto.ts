import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import type { AnnouncementAudience } from '@org/shared';

export const ANNOUNCEMENT_AUDIENCES: AnnouncementAudience[] = [
  'ALL',
  'RESIDENTS',
];

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_AUDIENCES)
  audience?: AnnouncementAudience;
}
