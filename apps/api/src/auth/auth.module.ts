import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import {
  ACCESS_TOKEN_TTL,
  JWT_ACCESS_SECRET,
} from './auth.types';
import { throttleDefaults } from '../security/throttle.config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { MembershipsModule } from '../memberships/memberships.module';
import { TwoFactorModule } from '../two-factor/two-factor.module';
import { SessionsModule } from '../sessions/sessions.module';
import { LoginLockoutService } from '../security/login-lockout.service';

@Module({
  imports: [
    JwtModule.register({
      secret: JWT_ACCESS_SECRET,
      signOptions: { expiresIn: ACCESS_TOKEN_TTL },
    }),
    MembershipsModule,
    TwoFactorModule,
    SessionsModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: throttleDefaults.globalTtlMs,
        limit: throttleDefaults.globalLimit,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    LoginLockoutService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard, LoginLockoutService],
})
export class AuthModule {}
