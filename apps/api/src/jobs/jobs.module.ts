import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [AuthModule, MarketplaceModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
