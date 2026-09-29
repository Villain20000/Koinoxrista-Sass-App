import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  imports: [AuditModule],
  controllers: [LegalController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
