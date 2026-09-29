import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from './documents.service';
import { StorageService } from './storage.service';

const admin = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@demo.gr',
  role: 'ADMIN',
  buildingId: 'building-1',
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  buildingId: 'building-1',
  type: 'ΚΑΝΟΝΙΣΜΟΣ',
  fileKey: 'key.pdf',
  fileName: 'kanonismos.pdf',
  sizeBytes: 4,
  uploadedById: 'admin-1',
  createdAt: new Date('2026-08-01T10:00:00Z'),
  uploadedBy: { firstName: 'Ada', lastName: 'Admin' },
  ...overrides,
});

function makePrisma() {
  return {
    document: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    },
  };
}

function makeStorage() {
  return {
    put: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(Buffer.from('data')),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: ReturnType<typeof makePrisma>;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    prisma = makePrisma();
    storage = makeStorage();
    service = new DocumentsService(
      storage as unknown as StorageService,
      prisma as unknown as PrismaService,
    );
  });

  const file = {
    buffer: Buffer.from('%PDF'),
    originalname: 'kanonismos.pdf',
    mimetype: 'application/pdf',
    size: 4,
  };

  describe('upload', () => {
    it('stores the file and persists a Document row with a keyed extension', async () => {
      prisma.document.create.mockResolvedValue(
        row({ fileKey: 'generated.pdf' }),
      );

      const view = await service.upload(
        'building-1',
        file,
        'ΚΑΝΟΝΙΣΜΟΣ',
        admin(),
      );

      expect(storage.put).toHaveBeenCalledWith(
        expect.stringMatching(/^[a-f0-9-]+\.pdf$/),
        file.buffer,
      );
      expect(prisma.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            buildingId: 'building-1',
            type: 'ΚΑΝΟΝΙΣΜΟΣ',
            fileName: 'kanonismos.pdf',
            sizeBytes: 4,
            uploadedById: 'admin-1',
          }),
        }),
      );
      expect(view.uploaderName).toBe('Ada Admin');
      expect(view.createdAt).toBe('2026-08-01T10:00:00.000Z');
    });

    it('accepts png, jpeg and text mime types', async () => {
      prisma.document.create.mockResolvedValue(row());

      for (const mimetype of ['image/png', 'image/jpeg', 'text/plain']) {
        await service.upload(
          'building-1',
          { ...file, mimetype },
          'ΠΡΑΚΤΙΚΟ',
          admin(),
        );
      }

      expect(storage.put).toHaveBeenCalledTimes(3);
    });

    it('rejects unsupported mime types', async () => {
      await expect(
        service.upload(
          'building-1',
          { ...file, mimetype: 'application/zip' },
          'ΑΛΛΟ',
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
      expect(prisma.document.create).not.toHaveBeenCalled();
    });

    it('rejects empty payloads and missing type', async () => {
      await expect(
        service.upload('building-1', undefined, 'ΤΥΠΟΣ', admin()),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upload(
          'building-1',
          { ...file, buffer: Buffer.alloc(0) },
          'ΤΥΠΟΣ',
          admin(),
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upload('building-1', file, '   ', admin()),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('cleans up the stored file if the row insert fails', async () => {
      prisma.document.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.upload('building-1', file, 'ΤΥΠΟΣ', admin()),
      ).rejects.toThrow('db down');
      expect(storage.remove).toHaveBeenCalledWith(
        expect.stringMatching(/\.pdf$/),
      );
    });

    it('blocks uploads from another building', async () => {
      await expect(
        service.upload('building-2', file, 'ΤΥΠΟΣ', admin()),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  describe('listForBuilding', () => {
    it('returns metadata newest first with uploader names', async () => {
      prisma.document.findMany.mockResolvedValue([
        row({ id: 'doc-new', createdAt: new Date('2026-08-20T10:00:00Z') }),
        row({ id: 'doc-old' }),
      ]);

      const views = await service.listForBuilding('building-1', admin());

      expect(views.map((v) => v.id)).toEqual(['doc-new', 'doc-old']);
      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { buildingId: 'building-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('download', () => {
    it('returns the stored buffer and original filename', async () => {
      prisma.document.findUnique.mockResolvedValue(row());

      const result = await service.download('doc-1', admin());

      expect(storage.get).toHaveBeenCalledWith('key.pdf');
      expect(result.buffer).toEqual(Buffer.from('data'));
      expect(result.fileName).toBe('kanonismos.pdf');
    });

    it('throws NotFound for missing docs and Forbidden across buildings', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      await expect(service.download('missing', admin())).rejects.toThrow(
        NotFoundException,
      );

      prisma.document.findUnique.mockResolvedValue(
        row({ buildingId: 'building-2' }),
      );

      await expect(service.download('doc-1', admin())).rejects.toThrow(
        ForbiddenException,
      );
      expect(storage.get).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the row first, then removes the file best-effort', async () => {
      prisma.document.findUnique.mockResolvedValue(row());
      prisma.document.delete.mockResolvedValue(row());
      storage.remove.mockRejectedValue(new Error('fs locked'));

      await expect(service.remove('doc-1', admin())).resolves.toBeUndefined();

      expect(prisma.document.delete).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
      expect(storage.remove).toHaveBeenCalledWith('key.pdf');
    });

    it('blocks removal from another building', async () => {
      prisma.document.findUnique.mockResolvedValue(
        row({ buildingId: 'building-9' }),
      );

      await expect(service.remove('doc-1', admin())).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.document.delete).not.toHaveBeenCalled();
    });
  });
});
