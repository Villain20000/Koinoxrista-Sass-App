import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { BuildingDocument } from '@org/shared';

import type { AuthenticatedUser } from '../auth/auth.types';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_SERVICE, StorageService } from './storage.service';

interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'text/plain': '.txt',
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  async upload(
    buildingId: string,
    file: UploadedFileLike | undefined,
    type: string | undefined,
    user: AuthenticatedUser,
  ): Promise<BuildingDocument> {
    assertSameBuilding(user, buildingId);
    const category = type?.trim();
    if (!category) throw new BadRequestException('Document type is required');

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('File is required');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('File exceeds the 10MB limit');
    }
    const extension = ALLOWED_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        'Unsupported file type (allowed: pdf, png, jpeg, txt)',
      );
    }

    const fileKey = `${randomUUID()}${extension}`;
    await this.storage.put(fileKey, file.buffer);

    try {
      const created = await this.prisma.document.create({
        data: {
          buildingId,
          type: category,
          fileKey,
          fileName: file.originalname,
          sizeBytes: file.buffer.length,
          uploadedById: user.id,
        },
        include: {
          uploadedBy: { select: { firstName: true, lastName: true } },
        },
      });

      return this.toView(created);
    } catch (error) {
      await this.storage.remove(fileKey).catch(() => undefined);
      throw error;
    }
  }

  async listForBuilding(
    buildingId: string,
    user: AuthenticatedUser,
  ): Promise<BuildingDocument[]> {
    assertSameBuilding(user, buildingId);

    const rows = await this.prisma.document.findMany({
      where: { buildingId },
      include: {
        uploadedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.toView(row));
  }

  async download(
    documentId: string,
    user: AuthenticatedUser,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    assertSameBuilding(user, doc.buildingId);

    const buffer = await this.storage.get(doc.fileKey);

    return { buffer, fileName: doc.fileName };
  }

  async remove(documentId: string, user: AuthenticatedUser): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!doc) throw new NotFoundException('Document not found');
    assertSameBuilding(user, doc.buildingId);

    await this.prisma.document.delete({ where: { id: documentId } });
    await this.storage.remove(doc.fileKey).catch(() => undefined);
  }

  private toView(row: {
    id: string;
    buildingId: string;
    type: string;
    fileName: string;
    sizeBytes: number;
    uploadedById: string;
    createdAt: Date;
    uploadedBy: { firstName: string; lastName: string };
  }): BuildingDocument {
    return {
      id: row.id,
      buildingId: row.buildingId,
      type: row.type,
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      uploadedById: row.uploadedById,
      uploaderName: [row.uploadedBy.firstName, row.uploadedBy.lastName]
        .filter(Boolean)
        .join(' '),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
