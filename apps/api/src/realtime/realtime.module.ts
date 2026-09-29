import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { JWT_ACCESS_SECRET, ACCESS_TOKEN_TTL } from '../auth/auth.types';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

/**
 * Global so feature services (votes, announcements, assembly, notifications)
 * can inject RealtimeService without importing this module; the root
 * AppModule registers it once.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: JWT_ACCESS_SECRET,
      signOptions: { expiresIn: ACCESS_TOKEN_TTL },
    }),
  ],
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
