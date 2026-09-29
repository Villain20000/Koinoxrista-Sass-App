import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/** Hex color `#RGB` or `#RRGGBB`. */
export const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Hostname shape for the (reserved) custom domain: dot-separated labels of
 * 1–63 alphanumeric/hyphen chars, no leading hyphen, at least two labels.
 */
export const CUSTOM_DOMAIN_REGEX =
  /^(?!-)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_REGEX.test(value);
}

export function isCustomDomain(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_DOMAIN_REGEX.test(value);
}

/** Logo must be an https URL so print outputs never load mixed content. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.includes('://')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.href === value;
  } catch {
    return false;
  }
}

function failure(message: string) {
  return (validationArguments: ValidationArguments): string =>
    `${validationArguments.property} ${message}`;
}

@ValidatorConstraint({ name: 'brandingHexColor', async: false })
export class BrandingHexColorConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isHexColor(value);
  }

  defaultMessage = failure('must be a hex color like #1e40af or #0af');
}

@ValidatorConstraint({ name: 'brandingCustomDomain', async: false })
export class BrandingCustomDomainConstraint
  implements ValidatorConstraintInterface
{
  validate(value: unknown): boolean {
    return isCustomDomain(value);
  }

  defaultMessage = failure(
    'must be a domain like brand.example.gr (no protocol/path)',
  );
}

@ValidatorConstraint({ name: 'brandingHttpsUrl', async: false })
export class BrandingHttpsUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isHttpsUrl(value);
  }

  defaultMessage = failure('must be an https:// URL');
}
