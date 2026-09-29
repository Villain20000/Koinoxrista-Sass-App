import { IsEmail } from 'class-validator';

/** Matches the shared `GrantAccountantDto`: grant by email, existing users only. */
export class GrantAccountantDto {
  @IsEmail()
  email!: string;
}
