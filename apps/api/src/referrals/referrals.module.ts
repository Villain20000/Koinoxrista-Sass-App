import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/**
 * Referral program: per-building codes, reward grants (referred + referrer)
 * and credit bookkeeping consumed by the self-billing recurring run.
 */
@Module({
  // PrismaModule is @Global; only auth/audit are needed explicitly.
  imports: [AuthModule, AuditModule],
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
