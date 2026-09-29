/** White-label branding settings for one building (Premium tier). */
export interface BuildingBrandingDto {
  buildingId: string;
  /** https-only URL of the logo rendered on print outputs. */
  logoUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  /** Organization display name; print headers fall back to the building name. */
  orgName?: string | null;
  footerText?: string | null;
  /** Reserved for custom-domain serving; validated but unused at runtime yet. */
  customDomain?: string | null;
  /** ISO datetime of the last change. */
  updatedAt?: string;
}

/** Partial update; omitted fields keep their current value, `null` clears. */
export interface UpdateBrandingDto {
  logoUrl?: string | null;
  primaryColor?: string;
  accentColor?: string;
  orgName?: string | null;
  footerText?: string | null;
  customDomain?: string | null;
}

/**
 * Safe subset served UNAUTHENTICATED by
 * `GET /public/buildings/:buildingId/branding` — display fields only, never
 * the reserved customDomain.
 */
export interface PublicBrandingDto {
  buildingId: string;
  logoUrl?: string | null;
  primaryColor: string;
  accentColor: string;
  orgName?: string | null;
  footerText?: string | null;
}
