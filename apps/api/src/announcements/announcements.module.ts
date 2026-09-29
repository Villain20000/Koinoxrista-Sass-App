import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { EmbeddingsModule } from '../assistant/embeddings.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

// NotificationsModule is @Global: NotificationsService is injectable here
// without an explicit import (same as ComplianceModule / VotesModule).
//
// EmbeddingsModule provides the fire-and-forget RAG ingestion hooks injected
// into AnnouncementsService (Phase 1, docs/LANGCHAIN_LANGGRAPH_PLAN.md).
@Module({
  imports: [AuditModule, EmbeddingsModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
