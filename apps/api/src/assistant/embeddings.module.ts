import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingsIngestionService } from './embeddings-ingestion.service';
import { EmbeddingsService } from './embeddings.service';
import { EmbeddingsAdminController } from './embeddings-admin.controller';

/**
 * Phase 1 (docs/LANGCHAIN_LANGGRAPH_PLAN.md): local pgvector embeddings.
 * Registered after AnnouncementsModule in AppModule so the on-write hooks
 * resolve; Exported so SchedulerModule can run the weekly embeddings sync.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [EmbeddingsAdminController],
  providers: [EmbeddingsService, EmbeddingsIngestionService],
  exports: [EmbeddingsService, EmbeddingsIngestionService],
})
export class EmbeddingsModule {}
