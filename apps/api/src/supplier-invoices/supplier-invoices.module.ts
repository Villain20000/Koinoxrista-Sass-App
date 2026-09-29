import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { SupplierInvoicesController } from './supplier-invoices.controller';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { OcrService } from './ocr.service';
import { MyDataPullService } from './mydata-pull.service';

@Module({
  imports: [AuditModule],
  controllers: [SupplierInvoicesController],
  providers: [SupplierInvoicesService, OcrService, MyDataPullService],
  exports: [SupplierInvoicesService, OcrService, MyDataPullService],
})
export class SupplierInvoicesModule {}
