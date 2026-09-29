import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { RemindersModule } from '../reminders/reminders.module';
import { createMailer, MAILER } from '../reminders/mailer';
import { OpenRegistrationController } from './open-registration.controller';
import { OpenRegistrationService } from './open-registration.service';

@Module({
  imports: [AuditModule, RemindersModule],
  controllers: [OpenRegistrationController],
  providers: [OpenRegistrationService, { provide: MAILER, useFactory: createMailer }],
  exports: [OpenRegistrationService],
})
export class OpenRegistrationModule {}