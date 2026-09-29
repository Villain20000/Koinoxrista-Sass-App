import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { LocalDiskStorage, S3Storage, STORAGE_SERVICE } from './storage.service';

function storageFactory() {
  if ((process.env.STORAGE_DRIVER ?? '').toLowerCase() === 's3') {
    return new S3Storage();
  }
  // S3_BUCKET hints at S3 even when driver is unset — auto-select with a warning.
  if (process.env.S3_BUCKET || process.env.BACKUP_S3_BUCKET) {
    return new S3Storage();
  }
  return new LocalDiskStorage();
}

@Module({
  imports: [AuthModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    LocalDiskStorage,
    S3Storage,
    { provide: STORAGE_SERVICE, useFactory: storageFactory },
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
