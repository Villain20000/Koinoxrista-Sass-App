import { IsOptional, IsString, MaxLength, Validate } from 'class-validator';

import {
  BrandingCustomDomainConstraint,
  BrandingHexColorConstraint,
  BrandingHttpsUrlConstraint,
} from './branding.validators';

/** Partial update; omitted fields keep their stored value, `null` clears. */
export class UpdateBrandingDto {
  @IsOptional()
  @Validate(BrandingHttpsUrlConstraint)
  logoUrl?: string | null;

  @IsOptional()
  @Validate(BrandingHexColorConstraint)
  primaryColor?: string;

  @IsOptional()
  @Validate(BrandingHexColorConstraint)
  accentColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  orgName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  footerText?: string | null;

  /** Reserved for custom-domain serving; validated but unused at runtime yet. */
  @IsOptional()
  @Validate(BrandingCustomDomainConstraint)
  customDomain?: string | null;
}
