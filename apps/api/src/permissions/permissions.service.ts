import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';

/** Allow-list of granular permission keys. */
export const PERMISSION_KEYS = [
  'billing.manage',
  'members.manage',
  'compliance.manage',
  'legal.manage',
  'votes.manage',
  'documents.manage',
  'treasury.manage',
  'reports.view',
  'settings.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const isPermissionKey = (key: string): key is PermissionKey =>
  (PERMISSION_KEYS as readonly string[]).includes(key);

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Effective permission check for `user` in `buildingId`. BUILDING_OWNER
   * implicitly holds every permission; ADMIN is allowed if a row exists.
   */
  async can(
    user: AuthenticatedUser,
    buildingId: string,
    key: PermissionKey,
  ): Promise<boolean> {
    if (user.role === Role.BUILDING_OWNER) return true;
    if (user.role !== Role.ADMIN) {
      return false;
    }
    const row = await this.prisma.adminPermission.findUnique({
      where: {
        userId_buildingId_permissionKey: { userId: user.id, buildingId, permissionKey: key },
      },
      select: { id: true },
    });
    return !!row;
  }

  /** Guard variant: throws 403 when not allowed. */
  async require(
    user: AuthenticatedUser,
    buildingId: string,
    key: PermissionKey,
  ): Promise<void> {
    if (!(await this.can(user, buildingId, key))) {
      throw new ForbiddenException(`Missing permission: ${key}`);
    }
  }

  /** BUILDING_OWNER only: list every admin + their granted keys. */
  async listAdmins(buildingId: string, user: AuthenticatedUser) {
    assertSameBuilding(user, buildingId);
    this.requireOwner(user);
    const admins = await this.prisma.user.findMany({
      where: { buildingId, role: { in: [Role.ADMIN, Role.BUILDING_OWNER] } },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    const grants = await this.prisma.adminPermission.findMany({
      where: { buildingId },
      select: { userId: true, permissionKey: true },
    });
    const byUser = new Map<string, string[]>();
    for (const grant of grants) {
      const list = byUser.get(grant.userId) ?? [];
      list.push(grant.permissionKey);
      byUser.set(grant.userId, list);
    }
    return admins.map((admin) => ({
      ...admin,
      permissions: byUser.get(admin.id) ?? [],
    }));
  }

  /** BUILDING_OWNER only: replace an admin's granted keys (audited). */
  async setPermissions(
    buildingId: string,
    targetUserId: string,
    keys: string[],
    user: AuthenticatedUser,
  ): Promise<void> {
    assertSameBuilding(user, buildingId);
    this.requireOwner(user);
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, buildingId, role: Role.ADMIN },
    });
    if (!target) {
      throw new NotFoundException('Target admin not found in building');
    }
    if (!keys.every(isPermissionKey)) {
      throw new ForbiddenException('Contains an unknown permission key');
    }

    await this.prisma.$transaction([
      this.prisma.adminPermission.deleteMany({ where: { buildingId, userId: targetUserId } }),
      this.prisma.adminPermission.createMany({
        data: keys.map((key) => ({
          userId: targetUserId,
          buildingId,
          permissionKey: key,
          grantedById: user.id,
        })),
      }),
    ]);

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'permissions.set',
      entity: 'user',
      entityId: targetUserId,
      metadata: { keys },
    });
  }

  private requireOwner(user: AuthenticatedUser): void {
    if (user.role !== Role.BUILDING_OWNER && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Only building owners manage permissions');
    }
  }
}