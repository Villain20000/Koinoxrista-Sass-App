import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CommissionsController } from './commission.controller';
import { CommissionsService } from './commission.service';
import { FeaturedSlotsController } from './featured-slots.controller';
import { FeaturedSlotsService } from './featured-slots.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [CommissionsController, FeaturedSlotsController],
  providers: [CommissionsService, FeaturedSlotsService],
  exports: [CommissionsService, FeaturedSlotsService],
})
export class MarketplaceModule {}
