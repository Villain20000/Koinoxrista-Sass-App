import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

// NotificationsModule is @Global: NotificationsService is injectable here
// without an explicit import (same as ComplianceModule / VotesModule).
@Module({
  imports: [AuditModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
