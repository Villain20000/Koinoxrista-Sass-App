import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PointsController } from './points.controller';
import { PointsService } from './points.service';

@Module({
  imports: [AuditModule],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}