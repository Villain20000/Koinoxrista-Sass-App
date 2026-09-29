import { Module, forwardRef } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlatformInvoiceController } from './platform-invoice.controller';
import { PlatformInvoiceService } from './platform-invoice.service';

/**
 * Self-billing of the SaaS's own platform fee. Mutually depends on
 * SubscriptionsModule (tier changes issue delta invoices; run-period needs the
 * subscription), so both sides use forwardRef to break the module cycle.
 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    forwardRef(() => SubscriptionsModule),
  ],
  controllers: [PlatformInvoiceController],
  providers: [PlatformInvoiceService],
  exports: [PlatformInvoiceService],
})
export class SelfBillingModule {}
