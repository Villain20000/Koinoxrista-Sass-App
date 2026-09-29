import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { InvoicesModule } from '../invoices/invoices.module';
import { RecurringModule } from '../recurring/recurring.module';
import { LateFeesModule } from '../late-fees/late-fees.module';
import { RemindersModule } from '../reminders/reminders.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { VotesModule } from '../votes/votes.module';
import { AuditModule } from '../audit/audit.module';
import { SchedulerService } from './scheduler.service';
import { SchedulerController } from './scheduler.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    InvoicesModule,
    RecurringModule,
    LateFeesModule,
    RemindersModule,
    MaintenanceModule,
    ComplianceModule,
    VotesModule,
    AuditModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class SchedulerModule {}