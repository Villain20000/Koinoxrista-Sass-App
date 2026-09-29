import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { VotesController } from './votes.controller';
import { VotesService } from './votes.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [VotesController],
  providers: [VotesService],
  exports: [VotesService],
})
export class VotesModule {}
