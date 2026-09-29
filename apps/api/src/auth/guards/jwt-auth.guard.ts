import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { AuthenticatedUser, HttpRequest } from '../auth.types';
import { JwtStrategy } from '../jwt.strategy';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  // Resolved lazily app-wide ({ strict: false }): many feature modules use
  // this guard without importing AuthModule, so constructor injection of the
  // strategy only works inside AuthModule's own context.
  constructor(private readonly moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const jwtStrategy = this.moduleRef.get(JwtStrategy, { strict: false });
    const user: AuthenticatedUser = await jwtStrategy.authenticate(
      request.headers.authorization,
    );
    request.user = user;
    return true;
  }
}
