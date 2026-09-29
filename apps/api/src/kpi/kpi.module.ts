import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { KpiController } from './kpi.controller';
import { KpiService } from './kpi.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [KpiController],
  providers: [KpiService],
  exports: [KpiService],
})
export class KpiModule {}