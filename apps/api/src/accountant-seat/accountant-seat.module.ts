import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BudgetsModule } from '../budgets/budgets.module';
import { ExportsModule } from '../exports/exports.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ReportsModule } from '../reports/reports.module';
import { AccountantAccessController } from './accountant-access.controller';
import { AccountantReadController } from './accountant-read.controller';
import { AccountantSeatService } from './accountant-seat.service';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    ReportsModule,
    BudgetsModule,
    PayoutsModule,
    PaymentsModule,
    ExportsModule,
  ],
  controllers: [AccountantAccessController, AccountantReadController],
  providers: [AccountantSeatService],
})
export class AccountantSeatModule {}
