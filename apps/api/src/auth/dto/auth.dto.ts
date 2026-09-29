import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72)
  @Matches(/\d/, { message: 'password must contain a number' })
  password!: string;

  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  /** Raw invite token from the invite URL; role/building come from it when present. */
  @IsOptional()
  @IsString()
  @MinLength(16)
  inviteToken?: string;

  /**
   * Referral code from `/register?ref=BLD-XXXXXX`. Buildings do not exist yet
   * at signup time, so no reward is granted here: the web app carries the code
   * (sessionStorage) and sends it with `POST /subscriptions/activate`, where
   * the reward pair is granted once the referred building exists.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}-[A-Za-z0-9]{6}$/, {
    message: 'referralCode must look like BLD-XXXXXX',
  })
  referralCode?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

/** POST /auth/change-password — current-password re-check then rehash. */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72)
  @Matches(/\d/, { message: 'password must contain a number' })
  newPassword!: string;
}

/** POST /auth/change-email — re-auth + switch to a (verified) new address. */
export class ChangeEmailDto {
  @IsString()
  @MinLength(1)
  password!: string;

  @IsEmail()
  newEmail!: string;
}

/** POST /auth/login/2fa — second step after a {twoFactorRequired, ticket}. */
export class TwoFactorLoginDto {
  /** Opaque HMAC-signed ticket from POST /auth/login (~5 min TTL). */
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  ticket!: string;

  /** 6-digit TOTP code or a single-use recovery code. */
  @IsString()
  @MinLength(6)
  @MaxLength(16)
  token!: string;
}
