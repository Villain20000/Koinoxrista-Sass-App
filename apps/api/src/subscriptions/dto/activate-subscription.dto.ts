import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Optional body for POST /subscriptions/activate. Carries the referral code
 * captured at `/register?ref=CODE` so the reward pair can be granted once the
 * building actually exists and its subscription goes ACTIVE.
 */
export class ActivateSubscriptionDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}-[A-Za-z0-9]{6}$/, {
    message: 'referralCode must look like BLD-XXXXXX',
  })
  @MaxLength(16)
  referralCode?: string;
}
