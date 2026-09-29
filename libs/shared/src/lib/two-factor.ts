/**
 * Wire types for TOTP two-factor authentication (sign-in second step).
 *
 * NOTE(barrel): export from src/index.ts (`export * from './lib/two-factor';`)
 * once the integrator wires the barrel — api/web currently mirror these shapes
 * locally until that line lands.
 */

/** Returned by POST /auth/login instead of tokens when 2FA is enabled. */
export interface TwoFactorRequiredResponse {
  twoFactorRequired: true;
  /** Short-lived (~5 min) HMAC-signed ticket proving the password step. */
  ticket: string;
}

/** POST /auth/login response: either a challenge or the signed-in token pair. */
export type LoginResponse =
  | ({ accessToken: string; refreshToken?: string } & {
      twoFactorRequired?: false;
    })
  | TwoFactorRequiredResponse;

/** POST /auth/2fa/setup response (secret is pending until /2fa/enable). */
export interface TwoFactorSetupResponse {
  /** base32-encoded secret — type it into the authenticator app or scan the URI. */
  secret: string;
  /** otpauth://totp/... URI for QR scanning. */
  otpauthUri: string;
}

/** POST /auth/2fa/enable response — recovery codes are shown exactly ONCE. */
export interface TwoFactorEnableResponse {
  enabled: true;
  recoveryCodes: string[];
}

/** POST /auth/2fa/disable response. */
export interface TwoFactorDisableResponse {
  twoFactorEnabled: false;
}

/** RFC-6238 defaults used across api/web hints. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Number of single-use recovery codes generated on enable. */
export const RECOVERY_CODE_COUNT = 10;
