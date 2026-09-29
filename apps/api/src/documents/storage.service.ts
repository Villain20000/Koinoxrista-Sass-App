import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

export const STORAGE_SERVICE = 'STORAGE_SERVICE';

export interface StorageService {
  put(fileKey: string, buffer: Buffer): Promise<void>;
  get(fileKey: string): Promise<Buffer>;
  remove(fileKey: string): Promise<void>;
}

@Injectable()
export class LocalDiskStorage implements StorageService {
  private readonly rootDir: string;

  constructor() {
    this.rootDir = process.env.DOCS_DIR ?? '.data/uploads';
  }

  async put(fileKey: string, buffer: Buffer): Promise<void> {
    const target = this.resolve(fileKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  }

  async get(fileKey: string): Promise<Buffer> {
    return fs.readFile(this.resolve(fileKey));
  }

  async remove(fileKey: string): Promise<void> {
    await fs.rm(this.resolve(fileKey), { force: true });
  }

  private resolve(fileKey: string): string {
    const normalized = path.normalize(fileKey);
    if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
      throw new Error(`Invalid storage key: ${fileKey}`);
    }
    return path.join(this.rootDir, normalized);
  }
}

/**
 * S3-compatible storage (Production). Activated when STORAGE_DRIVER=s3 and
 * S3_BUCKET is set. Uses @aws-sdk/client-s3 which is a lightweight dep
 * already installed for this module. Falls back to LocalDiskStorage when
 * the bucket is not configured, keeping `pnpm nx test api` green without S3.
 */
@Injectable()
export class S3Storage implements StorageService {
  private readonly logger = new Logger(S3Storage.name);
  private readonly bucket: string;
  private readonly prefix: string;
  // Lazy-loaded S3 client — avoids import cost in tests / local dev.
  private client: import('@aws-sdk/client-s3').S3Client | null = null;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? process.env.BACKUP_S3_BUCKET ?? '';
    this.prefix = (process.env.S3_PREFIX ?? 'documents').replace(/^\/|\/$/g, '');
  }

  private getClient(): import('@aws-sdk/client-s3').S3Client {
    if (this.client) return this.client;
    // Dynamic import keeps the module optional for test environments.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3Client } = require('@aws-sdk/client-s3') as typeof import('@aws-sdk/client-s3');
    this.client = new S3Client({
      region: process.env.S3_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT ?? process.env.BACKUP_S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
    return this.client;
  }

  private key(fileKey: string): string {
    const normalized = path.posix.normalize(fileKey);
    if (path.posix.isAbsolute(normalized) || normalized.startsWith('..')) {
      throw new Error(`Invalid storage key: ${fileKey}`);
    }
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }

  async put(fileKey: string, buffer: Buffer): Promise<void> {
    if (!this.bucket) {
      this.logger.warn('S3_BUCKET not set — falling back to LocalDiskStorage.put');
      const fallback = new LocalDiskStorage();
      return fallback.put(fileKey, buffer);
    }
    const { PutObjectCommand } = (await import('@aws-sdk/client-s3')) as typeof import('@aws-sdk/client-s3');
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(fileKey),
        Body: buffer,
        ServerSideEncryption: 'AES256',
      }),
    );
  }

  async get(fileKey: string): Promise<Buffer> {
    if (!this.bucket) {
      const fallback = new LocalDiskStorage();
      return fallback.get(fileKey);
    }
    const { GetObjectCommand } = (await import('@aws-sdk/client-s3')) as typeof import('@aws-sdk/client-s3');
    const res = await this.getClient().send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(fileKey) }),
    );
    const body = res.Body as unknown as Uint8Array | string | AsyncIterable<Uint8Array> | undefined;
    if (!body) throw new Error(`S3 object not found: ${fileKey}`);
    // Body can be a stream, Uint8Array, or string — normalize to Buffer.
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof body === 'string') return Buffer.from(body);
    // Stream case (Node.js Readable)
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async remove(fileKey: string): Promise<void> {
    if (!this.bucket) {
      const fallback = new LocalDiskStorage();
      return fallback.remove(fileKey);
    }
    const { DeleteObjectCommand } = (await import('@aws-sdk/client-s3')) as typeof import('@aws-sdk/client-s3');
    await this.getClient().send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(fileKey) }),
    );
  }
}
