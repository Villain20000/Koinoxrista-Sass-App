import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { MetersController } from './meters.controller';
import { MetersService } from './meters.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [MetersController],
  providers: [MetersService],
  exports: [MetersService],
})
export class MetersModule {}
