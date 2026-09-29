import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { API_SCOPES } from '@org/shared';

export const API_KEY_SCOPES = API_SCOPES;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsIn(API_KEY_SCOPES, { each: true })
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(API_KEY_SCOPES.length)
  scopes!: ApiKeyScope[];
}
