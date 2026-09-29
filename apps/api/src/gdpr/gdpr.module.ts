import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { GdprController } from './gdpr.controller';
import { GdprService } from './gdpr.service';

@Module({
  imports: [AuthModule],
  controllers: [GdprController],
  providers: [GdprService],
})
export class GdprModule {}
