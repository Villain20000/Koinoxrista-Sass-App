import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /auth/2fa/enable — completes setup with a code from the app. */
export class TwoFactorEnableDto {
  /** base32 secret previously returned by POST /auth/2fa/setup. */
  @IsString()
  @MinLength(16)
  @MaxLength(64)
  secret!: string;

  /** Current 6-digit TOTP code (a recovery code is NOT accepted here). */
  @IsString()
  @MinLength(6)
  @MaxLength(16)
  token!: string;
}

/** POST /auth/2fa/disable — requires the current password. */
export class TwoFactorDisableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;
}
