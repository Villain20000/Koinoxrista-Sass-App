import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentPlansController } from './payment-plans.controller';
import { PaymentPlansService } from './payment-plans.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PaymentPlansController],
  providers: [PaymentPlansService],
})
export class PaymentPlansModule {}
