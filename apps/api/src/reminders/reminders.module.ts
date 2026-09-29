import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { createMailer, MAILER } from './mailer';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [NotificationsModule],
  controllers: [RemindersController],
  providers: [RemindersService, { provide: MAILER, useFactory: createMailer }],
  exports: [RemindersService],
})
export class RemindersModule {}
