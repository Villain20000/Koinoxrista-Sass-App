import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExcelImportService } from './excel-import.service';

function makePrisma() {
  return {
    unit: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

const user: AuthenticatedUser = {
  id: 'user-1',
  email: 'a@b.gr',
  role: Role.ADMIN,
  buildingId: 'building-1',
};

const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

const CSV = [
  'Διαμέρισμα;Όροφος;Χιλιοστά;Καλοριφέρ',
  'Α1;0;600;3',
  'Β1;1;400;',
].join('\n');

describe('ExcelImportService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: { record: jest.Mock };
  let service: ExcelImportService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = { record: jest.fn() };
    service = new ExcelImportService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('tenancy', () => {
    it('forbids another building before touching the database', async () => {
      await expect(
        service.importUnits(
          'building-2',
          { filename: 'a.csv', contentBase64: base64(CSV) },
          user,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.unit.findMany).not.toHaveBeenCalled();
    });
  });

  describe('preview (no confirm)', () => {
    it('parses the sheet and reports counts without any writes', async () => {
      const result = await service.importUnits(
        'building-1',
        { filename: 'monades.csv', contentBase64: base64(CSV) },
        user,
      );

      expect(result).toEqual({
        rows: [
          {
            label: 'Α1',
            floor: 0,
            millimes: 600,
            radiatorCount: 3,
            ownerEmail: null,
            errors: [],
          },
          {
            label: 'Β1',
            floor: 1,
            millimes: 400,
            radiatorCount: null,
            ownerEmail: null,
            errors: [],
          },
        ],
        validCount: 2,
        errorCount: 0,
        totalMillimes: 1000,
        warnings: [],
      });
      expect(prisma.unit.findMany).not.toHaveBeenCalled();
      expect(prisma.unit.create).not.toHaveBeenCalled();
      expect(prisma.unit.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('never inserts invalid rows even with confirm', async () => {
      const csv = [
        'Διαμέρισμα;Χιλιοστά',
        'ΑΚΥΡΟ;99999',
        'ΝΕΟ;1000',
      ].join('\n');
      prisma.unit.create.mockResolvedValue({ id: 'u-new' });

      await expect(
        service.importUnits(
          'building-1',
          { filename: 'f.csv', contentBase64: base64(csv), confirm: true },
          user,
        ),
      ).resolves.toEqual({ created: 1, updated: 0 });

      expect(prisma.unit.create).toHaveBeenCalledTimes(1);
      expect(prisma.unit.create).toHaveBeenCalledWith({
        data: {
          buildingId: 'building-1',
          label: 'ΝΕΟ',
          floor: null,
          millimes: 1000,
          radiatorCount: 0,
        },
      });
    });
  });

  describe('confirm', () => {
    it('updates existing labels case-insensitively and creates the rest', async () => {
      prisma.unit.findMany.mockResolvedValue([
        { id: 'u-1', label: 'α1' },
        { id: 'u-2', label: 'Γ9' },
      ]);
      prisma.unit.update.mockResolvedValue({ id: 'u-1' });
      prisma.unit.create.mockResolvedValue({ id: 'u-new' });

      await expect(
        service.importUnits(
          'building-1',
          { filename: 'f.csv', contentBase64: base64(CSV), confirm: true },
          user,
        ),
      ).resolves.toEqual({ created: 1, updated: 1 });

      expect(prisma.unit.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { floor: 0, millimes: 600, radiatorCount: 3 },
      });
      expect(prisma.unit.create).toHaveBeenCalledWith({
        data: {
          buildingId: 'building-1',
          label: 'Β1',
          floor: 1,
          millimes: 400,
          radiatorCount: 0,
        },
      });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          buildingId: 'building-1',
          actorId: 'user-1',
          action: 'unit.excel-import',
          entity: 'unit',
          metadata: expect.objectContaining({
            filename: 'f.csv',
            created: 1,
            updated: 1,
            skippedErrors: 0,
          }),
        }),
      );
    });

    it('audits skipped error rows alongside the applied counts', async () => {
      const csv = [
        'Διαμέρισμα;Χιλιοστά',
        'ΚΑΚΟ;abc',
        'ΚΑΛΟ;1000',
      ].join('\n');
      prisma.unit.create.mockResolvedValue({ id: 'u-new' });

      await service.importUnits(
        'building-1',
        { filename: 'f.csv', contentBase64: base64(csv), confirm: true },
        user,
      );

      expect(prisma.unit.create).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ skippedErrors: 1 }),
        }),
      );
    });

    it('does not update fields the sheet left blank on existing units', async () => {
      prisma.unit.findMany.mockResolvedValue([{ id: 'u-1', label: 'Α1' }]);
      const csv = ['Διαμέρισμα;Όροφος;Χιλιοστά', 'Α1;;500'].join('\n');
      prisma.unit.update.mockResolvedValue({ id: 'u-1' });

      await service.importUnits(
        'building-1',
        { filename: 'f.csv', contentBase64: base64(csv), confirm: true },
        user,
      );

      expect(prisma.unit.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { millimes: 500 },
      });
    });
  });

  describe('bad uploads', () => {
    it('rejects empty base64 payloads with BadRequest', async () => {
      await expect(
        service.importUnits(
          'building-1',
          { filename: 'f.csv', contentBase64: '', confirm: false },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects sheets without a recognizable label column', async () => {
      const csv = ['Όροφος;Χιλιοστά', '1;1000'].join('\n');
      await expect(
        service.importUnits(
          'building-1',
          { filename: 'f.csv', contentBase64: base64(csv) },
          user,
        ),
      ).rejects.toThrow(/στήλη ετικέτας/i);
    });

    it('maps corrupt workbook bytes to a friendly BadRequest', async () => {
      // ZIP magic ("PK") forces the xlsx reader onto garbage bytes.
      const buffer = Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]);
      await expect(
        service.importUnits(
          'building-1',
          {
            filename: 'broken.xlsx',
            contentBase64: buffer.toString('base64'),
          },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
