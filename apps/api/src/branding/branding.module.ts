import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BrandingAdminController, PublicBrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

@Module({
  imports: [AuditModule],
  controllers: [BrandingAdminController, PublicBrandingController],
  providers: [BrandingService],
})
export class BrandingModule {}
