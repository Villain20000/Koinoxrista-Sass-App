import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BankImportController } from './bank-import.controller';
import { BankImportService } from './bank-import.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BankImportController],
  providers: [BankImportService],
})
export class BankImportModule {}
