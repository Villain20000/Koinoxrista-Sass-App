import { Global, Module } from '@nestjs/common';

import { NotificationsController, PushSubscriptionsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { createPushSender, PUSH_SENDER } from './push-sender';
import { createSmsSenderFromEnv, SMS_SENDER } from './sms-sender';

/**
 * Global so feature services (invoices, votes, jobs) can inject
 * NotificationsService without importing this module; the root AppModule
 * registers it once.
 */
@Global()
@Module({
  controllers: [NotificationsController, PushSubscriptionsController],
  providers: [
    NotificationsService,
    { provide: PUSH_SENDER, useFactory: createPushSender },
    { provide: SMS_SENDER, useFactory: () => createSmsSenderFromEnv(process.env) },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
