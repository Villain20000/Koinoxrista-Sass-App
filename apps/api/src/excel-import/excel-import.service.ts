import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  UnitImportPreviewDto,
  UnitImportRequestDto,
  UnitImportResultDto,
} from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import {
  mapUnitsColumns,
  normalizeUnitLabel,
  parseUnitsSheet,
  readSheetRows,
} from './parse-units-sheet';

@Injectable()
export class ExcelImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Dry-run preview or confirmed upsert of Units by label (case-insensitive
   * trim). Without `confirm` nothing is written; invalid rows never reach the
   * database in either mode.
   */
  async importUnits(
    buildingId: string,
    dto: UnitImportRequestDto,
    user: AuthenticatedUser,
  ): Promise<UnitImportPreviewDto | UnitImportResultDto> {
    assertSameBuilding(user, buildingId);
    const parsed = await this.parseUpload(dto);

    if (!dto.confirm) {
      return parsed;
    }

    const existing = await this.prisma.unit.findMany({
      where: { buildingId },
      select: { id: true, label: true },
    });
    const byLabelKey = new Map(
      existing.map((unit) => [normalizeUnitLabel(unit.label), unit.id]),
    );

    let created = 0;
    let updated = 0;
    for (const row of parsed.rows) {
      if (row.errors.length > 0 || !row.label || row.millimes == null) {
        continue;
      }
      const key = normalizeUnitLabel(row.label);
      const existingId = byLabelKey.get(key);
      if (existingId !== undefined) {
        await this.prisma.unit.update({
          where: { id: existingId },
          data: {
            ...(row.floor != null ? { floor: row.floor } : {}),
            millimes: row.millimes,
            ...(row.radiatorCount != null
              ? { radiatorCount: row.radiatorCount }
              : {}),
          },
        });
        updated++;
      } else {
        const unit = await this.prisma.unit.create({
          data: {
            buildingId,
            label: row.label,
            floor: row.floor,
            millimes: row.millimes,
            radiatorCount: row.radiatorCount ?? 0,
          },
        });
        byLabelKey.set(key, unit.id);
        created++;
      }
    }

    this.audit.record({
      buildingId,
      actorId: user.id,
      actorRole: user.role,
      action: 'unit.excel-import',
      entity: 'unit',
      entityId: null,
      metadata: {
        filename: dto.filename,
        created,
        updated,
        skippedErrors: parsed.errorCount,
        totalMillimes: parsed.totalMillimes,
      },
    });

    return { created, updated };
  }

  /** Decodes + parses the upload; unreadable files map to 400. */
  private async parseUpload(dto: UnitImportRequestDto) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(dto.contentBase64, 'base64');
    } catch {
      throw new BadRequestException('Μη έγκυρη κωδικοποίηση base64.');
    }
    if (buffer.length === 0) {
      throw new BadRequestException('Το αρχείο είναι κενό.');
    }

    let table: string[][];
    try {
      table = await readSheetRows(buffer, dto.filename ?? '');
    } catch {
      throw new BadRequestException(
        'Μη αναγνώσιμο αρχείο. Περιμένουμε .xlsx ή .csv με στήλες διαμερισμάτων.',
      );
    }
    if (table.length === 0) {
      throw new BadRequestException('Το αρχείο δεν περιέχει γραμμές.');
    }

    const columns = mapUnitsColumns(table[0]);
    if (!columns) {
      throw new BadRequestException(
        'Δεν βρέθηκε στήλη ετικέτας (Διαμέρισμα/Apartment/label/Κωδικός).',
      );
    }
    return parseUnitsSheet(table, columns);
  }
}
