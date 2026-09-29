import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { RemindersModule } from '../reminders/reminders.module';
import { createMailer, MAILER } from '../reminders/mailer';
import {
  CampaignOpenTrackingController,
  CampaignsController,
} from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuditModule, RemindersModule],
  controllers: [CampaignsController, CampaignOpenTrackingController],
  providers: [CampaignsService, { provide: MAILER, useFactory: createMailer }],
  exports: [CampaignsService],
})
export class CampaignsModule {}