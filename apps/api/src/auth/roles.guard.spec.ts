import './test-env';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { AuthenticatedUser } from './auth.types';
import { ROLES_KEY } from './decorators/roles.decorator';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';

const makeContext = (user?: AuthenticatedUser): ExecutionContext => {
  const request: Record<string, unknown> = {};
  if (user) request.user = user;
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => () => undefined,
    getClass: () =>
      class {
        static readonly ROLES_KEY = ROLES_KEY;
      },
  } as unknown as ExecutionContext;
};

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows when no roles metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(makeContext())).toBe(true);
  });

  describe('role matrix', () => {
    const users: Array<[Role, AuthenticatedUser]> = (
      [Role.ADMIN, Role.RESIDENT, Role.PROVIDER] as const
    ).map((role) => [
      role,
      {
        id: `u-${role}`,
        email: `${role.toLowerCase()}@demo.gr`,
        role,
        buildingId: 'b1',
      },
    ]);

    for (const [required, description] of [
      [[Role.ADMIN], '@Roles(ADMIN)'],
      [[Role.PROVIDER], '@Roles(PROVIDER)'],
      [[Role.RESIDENT], '@Roles(RESIDENT)'],
      [
        [Role.ADMIN, Role.PROVIDER],
        '@Roles(ADMIN, PROVIDER)',
      ],
    ] as Array<[Role[], string]>) {
      for (const [userRole, user] of users) {
        it(`${description} → ${userRole} ${
            required.includes(userRole) ? 'ALLOW' : 'DENY'
          }`, () => {
          reflector.getAllAndOverride.mockReturnValue(required);
          if (required.includes(userRole)) {
            expect(guard.canActivate(makeContext(user))).toBe(true);
          } else {
            expect(() => guard.canActivate(makeContext(user))).toThrow(
              ForbiddenException,
            );
          }
        });
      }
    }

    it('denies unauthenticated requests even for open-role endpoints', () => {
      reflector.getAllAndOverride.mockReturnValue([Role.RESIDENT]);
      expect(() => guard.canActivate(makeContext(undefined))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('Feature 6 role separation', () => {
    const asRole = (role: Role) =>
      ({ id: `u-${role}`, email: `${role}@demo.gr`, role, buildingId: 'b1' } as const);

    it('lets BUILDING_OWNER pass any route requiring ADMIN', () => {
      reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
      expect(guard.canActivate(makeContext(asRole(Role.BUILDING_OWNER)))).toBe(true);
    });

    it('does NOT let BUILDING_OWNER pass a RESIDENT-only route', () => {
      reflector.getAllAndOverride.mockReturnValue([Role.RESIDENT]);
      expect(() => guard.canActivate(makeContext(asRole(Role.BUILDING_OWNER)))).toThrow(
        ForbiddenException,
      );
    });

    it('lets ADMIN pass explicit ADMIN routes (back-compat)', () => {
      reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
      expect(guard.canActivate(makeContext(asRole(Role.ADMIN)))).toBe(true);
    });

    it('lets PLATFORM_ADMIN pass a PLATFORM_ADMIN route', () => {
      reflector.getAllAndOverride.mockReturnValue([Role.PLATFORM_ADMIN]);
      expect(guard.canActivate(makeContext(asRole(Role.PLATFORM_ADMIN)))).toBe(true);
    });

    it('keeps PLATFORM_ADMIN out of plain ADMIN (building-financial) routes', () => {
      reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
      expect(() => guard.canActivate(makeContext(asRole(Role.PLATFORM_ADMIN)))).toThrow(
        ForbiddenException,
      );
    });
  });
});

describe('Roles decorator', () => {
  it('stores roles under ROLES_KEY via SetMetadata', () => {
    class Dummy {
      @Roles(Role.ADMIN, Role.PROVIDER)
      handler(): void {
        return;
      }
    }
    const metadata = Reflect.getMetadata(
      ROLES_KEY,
      Dummy.prototype.handler,
    ) as Role[];
    expect(metadata).toEqual([Role.ADMIN, Role.PROVIDER]);
  });
});
