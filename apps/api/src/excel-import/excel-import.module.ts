import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ExcelImportController } from './excel-import.controller';
import { ExcelImportService } from './excel-import.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ExcelImportController],
  providers: [ExcelImportService],
})
export class ExcelImportModule {}
