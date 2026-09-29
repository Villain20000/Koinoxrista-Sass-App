import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { InvoicesController, MyInvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [AuditModule],
  controllers: [InvoicesController, MyInvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
