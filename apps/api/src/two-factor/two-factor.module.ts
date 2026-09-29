import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { TwoFactorService } from './two-factor.service';

/**
 * Provides TwoFactorService (TOTP setup/enable/disable + login second step).
 * Consumed by AuthModule; no controllers of its own — all endpoints live on
 * AuthController under the /auth prefix.
 */
@Module({
  imports: [AuditModule],
  providers: [TwoFactorService],
  exports: [TwoFactorService],
})
export class TwoFactorModule {}
