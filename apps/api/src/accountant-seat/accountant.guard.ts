import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { HttpRequest } from '../auth/auth.types';

/** Restricts a route to ACCOUNTANT seats (per-building access checked in service). */
@Injectable()
export class AccountantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const user = request.user;

    if (!user || user.role !== Role.ACCOUNTANT) {
      throw new ForbiddenException('Accountant access only');
    }

    return true;
  }
}
