import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** ~3 MB binary file once base64-decoded (≈4 MB encoded). */
export const UNITS_IMPORT_MAX_BASE64_LENGTH = 4_000_000;

/** Body of `POST /buildings/:buildingId/import-units`. */
export class ImportUnitsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(UNITS_IMPORT_MAX_BASE64_LENGTH)
  contentBase64!: string;

  /** When true the parsed valid rows are upserted; otherwise dry-run only. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
