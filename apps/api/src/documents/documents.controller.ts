import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DocumentsService, MAX_UPLOAD_BYTES } from './documents.service';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

interface HeaderSetter {
  setHeader(name: string, value: string): unknown;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('buildings/:buildingId/documents')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    // Default multer storage is memory — buffer lands on req.file.buffer.
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  upload(
    @Param('buildingId') buildingId: string,
    @UploadedFile() file: UploadedFile | undefined,
    @Body('type') type: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.upload(buildingId, file, type, user);
  }

  @Get('buildings/:buildingId/documents')
  @Roles(Role.ADMIN, Role.RESIDENT)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documentsService.listForBuilding(buildingId, user);
  }

  @Get('documents/:id/download')
  @Roles(Role.ADMIN, Role.RESIDENT)
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderSetter,
  ): Promise<StreamableFile> {
    const { buffer, fileName } = await this.documentsService.download(id, user);
    const asciiFallback =
      fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') ||
      'document';

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );

    return new StreamableFile(buffer);
  }

  @Delete('documents/:id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.remove(id, user);
  }
}
