import { IsOptional, IsObject, IsString } from 'class-validator';

/**
 * Accepts either a nested `json` field containing the myDATA payload
 * or a flat myDATA document at the top level. Unknown fields are
 * preserved via whitelist:false handling in the controller.
 */
export class ImportJsonDto {
  @IsOptional()
  @IsObject()
  json?: Record<string, unknown>;

  // allow arbitrary top-level keys when the raw myDATA doc is posted directly
  [key: string]: unknown;
}
