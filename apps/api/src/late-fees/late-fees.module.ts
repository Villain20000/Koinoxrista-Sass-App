import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { LateFeesController } from './late-fees.controller';
import { LateFeesService } from './late-fees.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [LateFeesController],
  providers: [LateFeesService],
  exports: [LateFeesService],
})
export class LateFeesModule {}
