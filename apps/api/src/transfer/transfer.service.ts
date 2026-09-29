import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AllocationStrategy, ComplianceKind, Role } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import {
  BUILDING_TRANSFER_VERSION,
  BuildingExportPayload,
  BuildingImportResult,
  TransferStrategy,
} from '@org/shared';

const STRATEGIES = Object.values(AllocationStrategy) as string[];
const COMPLIANCE_KINDS = Object.values(ComplianceKind) as string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/** Integer (cents / millimes / year) or null when absent or malformed. */
function asInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Non-negative float (square meters) or null when absent/malformed/negative. */
function asArea(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function pickStrategy(value: unknown): AllocationStrategy {
  return STRATEGIES.includes(value as string)
    ? (value as AllocationStrategy)
    : 'MILIMES';
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Full JSON backup of the caller's building. */
  async exportBuilding(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<BuildingExportPayload> {
    assertSameBuilding(user, buildingId);

    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
    });
    if (!building) {
      throw new NotFoundException('Building not found');
    }

    const [units, ownerships, categories, recurringExpenses, budgetLines, complianceItems] =
      await Promise.all([
        this.prisma.unit.findMany({
          where: { buildingId },
          orderBy: { label: 'asc' },
        }),
        this.prisma.ownership.findMany({
          where: { unit: { buildingId } },
          include: {
            unit: { select: { label: true } },
            user: { select: { email: true } },
          },
          orderBy: { id: 'asc' },
        }),
        this.prisma.expenseCategory.findMany({
          where: { buildingId },
          orderBy: { name: 'asc' },
        }),
        this.prisma.recurringExpense.findMany({
          where: { buildingId },
          include: { category: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.budgetLine.findMany({
          where: { buildingId },
          include: { category: { select: { name: true } } },
          orderBy: [{ year: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.complianceItem.findMany({
          where: { buildingId },
          orderBy: { startsOn: 'asc' },
        }),
      ]);

    return {
      version: BUILDING_TRANSFER_VERSION,
      exportedAt: new Date().toISOString(),
      building: {
        name: building.name,
        address: building.address,
        city: building.city,
      },
      units: units.map((unit) => ({
        label: unit.label,
        floor: unit.floor,
        millimes: unit.millimes,
        radiatorCount: unit.radiatorCount,
        squareMeters: unit.squareMeters,
        shareFraction: unit.shareFraction,
      })),
      ownerships: ownerships.map((ownership) => ({
        unitLabel: ownership.unit.label,
        email: ownership.user.email,
        shareMillimes: ownership.shareMillimes,
      })),
      categories: categories.map((category) => ({
        name: category.name,
        strategy: category.strategy,
      })),
      recurringExpenses: recurringExpenses.map((template) => ({
        name: template.name,
        amountCents: template.amountCents,
        strategy: template.strategy,
        active: template.active,
        categoryName: template.category?.name ?? null,
        lastPeriod: template.lastPeriod,
      })),
      budgetLines: budgetLines.map((line) => ({
        year: line.year,
        name: line.name,
        plannedCents: line.plannedCents,
        categoryName: line.category?.name ?? null,
      })),
      complianceItems: complianceItems.map((item) => ({
        kind: item.kind,
        title: item.title,
        providerName: item.providerName,
        policyNumber: item.policyNumber,
        premiumCents: item.premiumCents,
        startsOn: item.startsOn.toISOString(),
        endsOn: item.endsOn.toISOString(),
        notes: item.notes,
      })),
    };
  }

  /**
   * Creates a NEW building from a transfer payload inside one transaction.
   * Owner emails are re-linked to existing users only; anything unresolvable
   * (unknown email, missing category, invalid date/kind) is skipped and
   * reported instead of failing the whole import.
   */
  async importBuilding(
    payload: unknown,
    user: AuthenticatedUser,
  ): Promise<BuildingImportResult> {
    if (!isRecord(payload)) {
      throw new BadRequestException('payload must be an object');
    }
    if (payload.version !== BUILDING_TRANSFER_VERSION) {
      throw new BadRequestException(
        `Unsupported payload version (expected ${BUILDING_TRANSFER_VERSION})`,
      );
    }

    const source = isRecord(payload.building) ? payload.building : {};
    const name = asString(source.name);
    if (!name) {
      throw new BadRequestException('payload.building.name is required');
    }

    const result: BuildingImportResult = {
      buildingId: '',
      created: {
        units: 0,
        ownerships: 0,
        categories: 0,
        recurringExpenses: 0,
        budgetLines: 0,
        complianceItems: 0,
      },
      skipped: { ownerships: [], recurring: [], budgetLines: [], complianceItems: [] },
    };

    result.buildingId = await this.prisma.$transaction(async (tx) => {
      const building = await tx.building.create({
        data: {
          name,
          address: asString(source.address) ?? '',
          city: asString(source.city) ?? 'Thessaloniki',
        },
      });

      // Units — ids are always regenerated; duplicate labels are ignored.
      const unitIdsByLabel = new Map<string, string>();
      for (const raw of rows(payload.units)) {
        const label = asString(raw.label);
        const millimes = asInt(raw.millimes);
        if (!label || millimes === null || millimes < 0 || unitIdsByLabel.has(label)) {
          continue;
        }
        const shareFraction = asInt(raw.shareFraction);
        const unit = await tx.unit.create({
          data: {
            buildingId: building.id,
            label,
            floor: raw.floor == null ? null : asInt(raw.floor),
            millimes,
            radiatorCount: asInt(raw.radiatorCount) ?? 0,
            squareMeters: asArea(raw.squareMeters),
            shareFraction:
              shareFraction !== null && shareFraction >= 0 && shareFraction <= 1000
                ? shareFraction
                : null,
          },
        });
        unitIdsByLabel.set(label, unit.id);
        result.created.units += 1;
      }

      // Expense categories — unknown strategies fall back to MILIMES.
      const categoryIdsByName = new Map<string, string>();
      for (const raw of rows(payload.categories)) {
        const categoryName = asString(raw.name);
        if (!categoryName || categoryIdsByName.has(categoryName)) {
          continue;
        }
        const category = await tx.expenseCategory.create({
          data: {
            buildingId: building.id,
            name: categoryName,
            strategy: pickStrategy(raw.strategy),
          },
        });
        categoryIdsByName.set(categoryName, category.id);
        result.created.categories += 1;
      }

      const resolveCategory = (
        value: unknown,
      ): string | null | 'missing' => {
        if (value == null) return null;
        const categoryName = asString(value);
        if (!categoryName) return null;
        return categoryIdsByName.get(categoryName) ?? 'missing';
      };
      const strategyOf = (value: unknown): TransferStrategy =>
        pickStrategy(value) as TransferStrategy;

      // Recurring templates — named category must resolve, else skip+report.
      for (const raw of rows(payload.recurringExpenses)) {
        const templateName = asString(raw.name);
        if (!templateName) continue;
        const amountCents = asInt(raw.amountCents);
        const categoryId = resolveCategory(raw.categoryName);
        if (
          amountCents === null ||
          amountCents < 0 ||
          categoryId === 'missing'
        ) {
          result.skipped.recurring.push(templateName);
          continue;
        }
        await tx.recurringExpense.create({
          data: {
            buildingId: building.id,
            name: templateName,
            amountCents,
            strategy: strategyOf(raw.strategy),
            active: typeof raw.active === 'boolean' ? raw.active : true,
            categoryId,
            lastPeriod: asString(raw.lastPeriod),
          },
        });
        result.created.recurringExpenses += 1;
      }

      // Budget lines — same category resolution as templates.
      for (const raw of rows(payload.budgetLines)) {
        const lineName = asString(raw.name);
        const year = asInt(raw.year);
        const plannedCents = asInt(raw.plannedCents);
        if (!lineName) continue;
        const categoryId = resolveCategory(raw.categoryName);
        if (
          year === null ||
          plannedCents === null ||
          plannedCents < 0 ||
          categoryId === 'missing'
        ) {
          result.skipped.budgetLines.push(lineName);
          continue;
        }
        await tx.budgetLine.create({
          data: {
            buildingId: building.id,
            year,
            name: lineName,
            plannedCents,
            categoryId,
          },
        });
        result.created.budgetLines += 1;
      }

      // Compliance items — invalid dates or kinds are skipped+reported.
      for (const raw of rows(payload.complianceItems)) {
        const title = asString(raw.title);
        if (!title) continue;
        const kind = raw.kind;
        const startsOn = parseIsoDate(raw.startsOn);
        const endsOn = parseIsoDate(raw.endsOn);
        if (
          !COMPLIANCE_KINDS.includes(kind as string) ||
          startsOn === null ||
          endsOn === null
        ) {
          result.skipped.complianceItems.push(title);
          continue;
        }
        await tx.complianceItem.create({
          data: {
            buildingId: building.id,
            kind: kind as ComplianceKind,
            title,
            providerName: asString(raw.providerName),
            policyNumber: asString(raw.policyNumber),
            premiumCents: raw.premiumCents == null ? null : asInt(raw.premiumCents),
            startsOn,
            endsOn,
            notes: asString(raw.notes),
          },
        });
        result.created.complianceItems += 1;
      }

      // Ownerships — only EXISTING user emails are re-linked.
      const periodStart = new Date(new Date().getFullYear(), 0, 1);
      for (const raw of rows(payload.ownerships)) {
        const email = asString(raw.email);
        if (!email) continue;
        const normalized = email.toLowerCase();
        const owner = await tx.user.findUnique({ where: { email: normalized } });
        const unitId = unitIdsByLabel.get(asString(raw.unitLabel) ?? '');
        const shareMillimes = asInt(raw.shareMillimes);
        if (!owner || !unitId || shareMillimes === null || shareMillimes < 0) {
          result.skipped.ownerships.push(normalized);
          continue;
        }
        await tx.ownership.create({
          data: {
            unitId,
            userId: owner.id,
            shareMillimes,
            periodStart,
          },
        });
        result.created.ownerships += 1;
      }

      // The importing admin becomes the first member of the new building.
      await tx.membership.create({
        data: {
          userId: user.id,
          buildingId: building.id,
          role: Role.ADMIN,
          isDefault: true,
        },
      });

      return building.id;
    });

    this.audit.record({
      buildingId: result.buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'building.transfer.import',
      entity: 'building',
      entityId: result.buildingId,
      metadata: {
        created: result.created,
        skippedCounts: {
          ownerships: result.skipped.ownerships.length,
          recurring: result.skipped.recurring.length,
          budgetLines: result.skipped.budgetLines.length,
          complianceItems: result.skipped.complianceItems.length,
        },
      },
    });

    return result;
  }
}
