import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';

@Module({
  imports: [AuditModule],
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
