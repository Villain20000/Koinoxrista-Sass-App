import { Module } from '@nestjs/common';

import { OwnershipsController } from './ownerships.controller';
import { OwnershipsService } from './ownerships.service';

@Module({
  controllers: [OwnershipsController],
  providers: [OwnershipsService],
  exports: [OwnershipsService],
})
export class OwnershipsModule {}
