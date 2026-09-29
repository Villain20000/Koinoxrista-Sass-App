import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DELETE_CONFIRMATION,
  type DeleteMeDto,
} from './gdpr.dto';
import { GdprService } from './gdpr.service';

interface HeaderSetter {
  setHeader(name: string, value: string): unknown;
}

/** Self-service data-subject rights — a user may only act on their own data. */
@Controller('gdpr')
@UseGuards(JwtAuthGuard)
export class GdprController {
  constructor(private readonly gdprService: GdprService) {}

  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderSetter,
  ): Promise<StreamableFile> {
    const payload = await this.gdprService.exportUserData(user.id);
    const json = JSON.stringify(payload, null, 2);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', String(Buffer.byteLength(json)));
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="gdpr-export.json"',
    );

    return new StreamableFile(Buffer.from(json));
  }

  @Post('delete-me')
  async deleteMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DeleteMeDto,
  ): Promise<{ anonymized: boolean }> {
    if (body?.confirm !== DELETE_CONFIRMATION) {
      throw new BadRequestException(
        'Πληκτρολογήστε DELETE για επιβεβαίωση διαγραφής.',
      );
    }
    return this.gdprService.deleteAccount(user.id);
  }
}
