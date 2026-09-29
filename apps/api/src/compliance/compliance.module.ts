import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BuildingComplianceController, ComplianceItemController } from './compliance.controller';
import { ComplianceService } from './compliance.service';

@Module({
  imports: [AuditModule],
  controllers: [BuildingComplianceController, ComplianceItemController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
