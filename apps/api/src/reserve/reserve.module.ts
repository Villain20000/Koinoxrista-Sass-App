import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ReserveController } from './reserve.controller';
import { ReserveService } from './reserve.service';

@Module({
  imports: [AuditModule],
  controllers: [ReserveController],
  providers: [ReserveService],
  exports: [ReserveService],
})
export class ReserveModule {}
