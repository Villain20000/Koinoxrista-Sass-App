import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { MetersModule } from '../meters/meters.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [AuditModule, MetersModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
