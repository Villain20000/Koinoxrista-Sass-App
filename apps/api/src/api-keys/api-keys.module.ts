import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyRateLimiter } from './api-key-rate-limiter';
import { PublicApiController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [AuthModule],
  controllers: [ApiKeysController, PublicApiController],
  providers: [
    ApiKeysService,
    PublicApiService,
    ApiKeyGuard,
    { provide: ApiKeyRateLimiter, useFactory: () => new ApiKeyRateLimiter() },
  ],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
