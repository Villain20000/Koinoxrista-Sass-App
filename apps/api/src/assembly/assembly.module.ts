import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { LLM_PROVIDER, createLlmProvider } from '../assistant/llm-provider';
import { AssemblyController } from './assembly.controller';
import { AssemblyService } from './assembly.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AssemblyController],
  providers: [
    AssemblyService,
    { provide: LLM_PROVIDER, useFactory: createLlmProvider },
  ],
  exports: [AssemblyService],
})
export class AssemblyModule {}
