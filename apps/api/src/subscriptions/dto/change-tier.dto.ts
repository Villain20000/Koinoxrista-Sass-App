import { IsIn } from 'class-validator';

import { BILLING_CYCLES, SUBSCRIPTION_TIERS } from '@org/shared';
import type { BillingCycle, SubscriptionTier } from '@org/shared';

export class ChangeTierDto {
  @IsIn(SUBSCRIPTION_TIERS)
  tier!: SubscriptionTier;

  @IsIn(BILLING_CYCLES)
  billingCycle!: BillingCycle;
}
