import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import {
  BANK_FEED_ADAPTER,
  createBankFeedAdapter,
} from './openbanking.adapter';
import { OpenBankingController } from './openbanking.controller';
import { OpenBankingService } from './openbanking.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [OpenBankingController],
  providers: [
    OpenBankingService,
    // Mirrors the myDATA adapter wiring: OPENBANKING_MODE picks the feed.
    { provide: BANK_FEED_ADAPTER, useFactory: () => createBankFeedAdapter() },
  ],
})
export class OpenBankingModule {}
