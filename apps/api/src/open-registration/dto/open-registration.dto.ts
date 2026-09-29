import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterOpenDto {
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

  /** 8-char per-building entry code shown to residents by the管理员. */
  @IsString()
  @Matches(/^[A-Za-z0-9]{8}$/, { message: 'building code must be 8 alphanumeric characters' })
  buildingCode!: string;
}

export class VerifyEmailDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;
}