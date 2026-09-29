import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({
  imports: [AuditModule],
  controllers: [PartnersController],
  providers: [PartnersService],
})
export class PartnersModule {}
