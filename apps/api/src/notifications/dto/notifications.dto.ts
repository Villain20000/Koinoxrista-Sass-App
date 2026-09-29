import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListNotificationsQueryDto {
  /** Any truthy value (conventionally '1') restricts the page to unread rows. */
  @IsOptional()
  @IsString()
  @MaxLength(4)
  unread?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}

export class SubscribePushDto {
  @IsString()
  @MaxLength(2048)
  endpoint!: string;

  @IsString()
  @MaxLength(512)
  p256dh!: string;

  @IsString()
  @MaxLength(512)
  auth!: string;
}

export class UnsubscribePushDto {
  @IsString()
  @MaxLength(2048)
  endpoint!: string;
}
