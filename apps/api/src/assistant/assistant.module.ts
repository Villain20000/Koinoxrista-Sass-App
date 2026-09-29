import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { LLM_PROVIDER, createLlmProvider } from './llm-provider';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [AssistantController],
  providers: [AssistantService, { provide: LLM_PROVIDER, useFactory: createLlmProvider }],
  exports: [AssistantService],
})
export class AssistantModule {}