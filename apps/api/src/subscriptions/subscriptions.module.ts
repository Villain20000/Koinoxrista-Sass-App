import { Module, forwardRef } from '@nestjs/common';

import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SelfBillingModule } from '../self-billing/self-billing.module';
import { ReferralsModule } from '../referrals/referrals.module';

@Module({
  imports: [forwardRef(() => SelfBillingModule), ReferralsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
