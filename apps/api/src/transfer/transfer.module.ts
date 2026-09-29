import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [TransferController],
  providers: [TransferService],
})
export class TransferModule {}
