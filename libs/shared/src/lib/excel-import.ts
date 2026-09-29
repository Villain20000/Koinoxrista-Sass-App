/**
 * Excel/CSV units importer. Admins upload a spreadsheet of apartments into an
 * existing building; the API first answers with a validated dry-run preview
 * and only upserts Units once the same payload is re-sent with `confirm`.
 */
export interface UnitImportRowDto {
  label: string;
  floor?: number | null;
  millimes?: number | null;
  radiatorCount?: number | null;
  ownerEmail?: string | null;
  /** Row-level validation problems in Greek; empty array = valid row. */
  errors: string[];
}

/** Dry-run response: every sheet row plus validity counts (no writes). */
export interface UnitImportPreviewDto {
  rows: UnitImportRowDto[];
  validCount: number;
  errorCount: number;
  /** Σ millimes of the valid rows; ≠ 1000 is surfaced as a warning only. */
  totalMillimes: number;
  warnings: string[];
}

/** Apply response after confirmed upsert by label (case-insensitive trim). */
export interface UnitImportResultDto {
  created: number;
  updated: number;
}

/** Body of `POST /buildings/:buildingId/import-units`. */
export interface UnitImportRequestDto {
  filename: string;
  contentBase64: string;
  confirm?: boolean;
}
