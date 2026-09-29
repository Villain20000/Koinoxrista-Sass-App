import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PdfService } from './pdf.service';

/** Minimal structural response (avoids a hard @types/express dependency). */
interface HeaderResponse {
  setHeader(name: string, value: string): this;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Get('invoices/:id/pdf')
  @Roles(Role.ADMIN, Role.RESIDENT)
  async invoicePdf(
    @Param('id') invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    const file = await this.pdfService.invoicePdf(invoiceId, user);
    this.respond(res, file);
    return file.body;
  }

  @Get('statements/:unitId/pdf')
  @Roles(Role.ADMIN, Role.RESIDENT)
  async statementPdf(
    @Param('unitId') unitId: string,
    @Query('year') year: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    const file = await this.pdfService.statementPdf(unitId, year ?? new Date().getUTCFullYear().toString(), user);
    this.respond(res, file);
    return file.body;
  }

  private respond(res: HeaderResponse, file: { body: Buffer; filename: string; etag: string; contentType: string }): void {
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.filename)}"`,
    );
    res.setHeader('ETag', `"${file.etag}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
  }
}