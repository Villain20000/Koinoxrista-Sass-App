import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import {
  ACCESS_TOKEN_TTL,
  JWT_ACCESS_SECRET,
} from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';

@Module({
  imports: [
    // Self-contained guard setup: this module must work regardless of who
    // imports it (AuthModule today), without creating a circular dependency.
    JwtModule.register({
      secret: JWT_ACCESS_SECRET,
      signOptions: { expiresIn: ACCESS_TOKEN_TTL },
    }),
  ],
  controllers: [MembershipsController],
  providers: [MembershipsService, JwtStrategy, JwtAuthGuard],
  exports: [MembershipsService],
})
export class MembershipsModule {}
