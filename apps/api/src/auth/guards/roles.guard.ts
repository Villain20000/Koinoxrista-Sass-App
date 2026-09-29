import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { HttpRequest } from '../auth.types';
import { ROLES_KEY } from '../decorators/roles.decorator';

const ADMIN_LIKE: Role[] = [Role.ADMIN, Role.BUILDING_OWNER];

/**
 * Resolves the effective set of building-admin privileges for a route once
 * Feature 6 role separation is applied:
 *   - `BUILDING_OWNER` (理事長) satisfies any route requiring `ADMIN`.
 *   - `PLATFORM_ADMIN` is a strictly platform role: it only ever passes
 *     routes that explicitly requested it (never a plain `ADMIN` route),
 *     keeping platform operators out of per-building financial data.
 *   - `ADMIN` (理事) keeps its legacy access (superseded by BUILDING_OWNER for
 *     new installs, retained for back-compat during migration).
 */
function satisfies(requiredRoles: Role[], userRole: Role): boolean {
  if (requiredRoles.includes(userRole)) return true;
  if (requiredRoles.includes(Role.PLATFORM_ADMIN)) return false;
  // BUILDING_OWNER is a superset of ADMIN (and only of ADMIN).
  if (userRole === Role.BUILDING_OWNER) {
    return requiredRoles.includes(Role.ADMIN);
  }
  return false;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<HttpRequest>();
    const user = request.user;

    if (!user || !satisfies(requiredRoles, user.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}

export { ADMIN_LIKE };