import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BuildingAssetsController, MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [AuditModule],
  controllers: [BuildingAssetsController, MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
