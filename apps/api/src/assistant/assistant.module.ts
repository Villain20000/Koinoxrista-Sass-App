import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { LLM_PROVIDER, createLlmProvider } from './llm-provider';
import { EmbeddingsModule } from './embeddings.module';

@Module({
  // EmbeddingsModule is imported now so Phase 2 (RAG_ENGINE=langgraph) can
  // inject EmbeddingsService into AssistantService without another migration.
  imports: [AuditModule, NotificationsModule, EmbeddingsModule],
  controllers: [AssistantController],
  providers: [AssistantService, { provide: LLM_PROVIDER, useFactory: createLlmProvider }],
  exports: [AssistantService],
})
export class AssistantModule {}
