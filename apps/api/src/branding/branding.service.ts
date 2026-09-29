import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  BuildingBrandingDto,
  PublicBrandingDto,
} from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateBrandingDto } from './dto/update-branding.dto';

/** Applied when a building has no branding row yet (matches DB defaults). */
export const DEFAULT_BRANDING = {
  primaryColor: '#1e40af',
  accentColor: '#0ea5e9',
};

/** Structural row shape (avoids a hard dependency on the generated client). */
type BrandingRow = {
  buildingId: string;
  logoUrl: string | null;
  primaryColor: string;
  accentColor: string;
  orgName: string | null;
  footerText: string | null;
  customDomain: string | null;
  updatedAt: Date;
};

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Current settings; built-in defaults when never configured. */
  async get(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<BuildingBrandingDto> {
    this.assertOwned(user, buildingId);
    const row = await this.prisma.buildingBranding.findUnique({
      where: { buildingId },
    });
    return this.toDto(row ?? this.emptyRow(buildingId));
  }

  /**
   * Partial update with merge semantics: omitted fields keep their stored
   * value, explicit `null` clears an optional field. Audited as
   * `branding.update`.
   */
  async update(
    buildingId: string,
    dto: UpdateBrandingDto,
    user: AuthenticatedUser,
  ): Promise<BuildingBrandingDto> {
    this.assertOwned(user, buildingId);

    const existing = await this.prisma.buildingBranding.findUnique({
      where: { buildingId },
    });
    // Merge over stored values first, built-in defaults last.
    const merged = {
      logoUrl:
        dto.logoUrl !== undefined ? dto.logoUrl : (existing?.logoUrl ?? null),
      primaryColor:
        dto.primaryColor ?? existing?.primaryColor ?? DEFAULT_BRANDING.primaryColor,
      accentColor:
        dto.accentColor ?? existing?.accentColor ?? DEFAULT_BRANDING.accentColor,
      orgName:
        dto.orgName !== undefined ? dto.orgName : (existing?.orgName ?? null),
      footerText:
        dto.footerText !== undefined
          ? dto.footerText
          : (existing?.footerText ?? null),
      customDomain:
        dto.customDomain !== undefined
          ? dto.customDomain
          : (existing?.customDomain ?? null),
    };

    const row = await this.upsertBranding(buildingId, merged);

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'branding.update',
      entity: 'building_branding',
      entityId: buildingId,
      metadata: { fields: Object.keys(dto) },
    });

    return this.toDto(row);
  }

  /**
   * Safe display subset for the UNAUTHENTICATED public endpoint. Never
   * exposes the reserved customDomain. Unknown buildings yield defaults so
   * future custom-domain serving can render without special-casing.
   */
  async getPublic(buildingId: string): Promise<PublicBrandingDto> {
    const row = await this.prisma.buildingBranding.findUnique({
      where: { buildingId },
      select: {
        buildingId: true,
        logoUrl: true,
        primaryColor: true,
        accentColor: true,
        orgName: true,
        footerText: true,
      },
    });
    return {
      buildingId,
      logoUrl: row?.logoUrl ?? null,
      primaryColor: row?.primaryColor ?? DEFAULT_BRANDING.primaryColor,
      accentColor: row?.accentColor ?? DEFAULT_BRANDING.accentColor,
      orgName: row?.orgName ?? null,
      footerText: row?.footerText ?? null,
    };
  }

  /** Upsert that translates the reserved customDomain unique violation to 409. */
  private async upsertBranding(
    buildingId: string,
    data: Omit<BrandingRow, 'buildingId' | 'updatedAt'>,
  ): Promise<BrandingRow> {
    try {
      return await this.prisma.buildingBranding.upsert({
        where: { buildingId },
        create: { buildingId, ...data },
        update: data,
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          'customDomain is already used by another building',
        );
      }
      throw error;
    }
  }

  /**
   * Settings are addressed by building id; cross-building access is hidden
   * behind a 404 so the existence of other buildings is not disclosed.
   */
  private assertOwned(user: AuthenticatedUser, buildingId: string): void {
    if (!user.buildingId || user.buildingId !== buildingId) {
      throw new NotFoundException('Building not found');
    }
  }

  private emptyRow(buildingId: string): BrandingRow {
    return {
      buildingId,
      logoUrl: null,
      primaryColor: DEFAULT_BRANDING.primaryColor,
      accentColor: DEFAULT_BRANDING.accentColor,
      orgName: null,
      footerText: null,
      customDomain: null,
      updatedAt: new Date(0),
    };
  }

  private toDto(row: BrandingRow): BuildingBrandingDto {
    return {
      buildingId: row.buildingId,
      logoUrl: row.logoUrl,
      primaryColor: row.primaryColor,
      accentColor: row.accentColor,
      orgName: row.orgName,
      footerText: row.footerText,
      customDomain: row.customDomain,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
