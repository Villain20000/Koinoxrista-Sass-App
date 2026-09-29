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
import { ExportsService } from './exports.service';
import { UnitYearStatement } from './statements';

/** Minimal structural response (avoids a hard @types/express dependency). */
interface HeaderResponse {
  setHeader(name: string, value: string): this;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get('buildings/:buildingId/export/ledger.csv')
  @Roles(Role.ADMIN)
  async ledger(
    @Param('buildingId') buildingId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    const file = await this.exportsService.ledgerCsv(buildingId, year, user);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return file.body;
  }

  @Get('buildings/:buildingId/export/arrears.csv')
  @Roles(Role.ADMIN)
  async arrears(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    const file = await this.exportsService.arrearsCsv(buildingId, user);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return file.body;
  }

  @Get('buildings/:buildingId/statements/unit/:unitId/year/:year')
  @Roles(Role.ADMIN)
  unitStatement(
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Param('year') year: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UnitYearStatement> {
    return this.exportsService.unitStatement(buildingId, unitId, year, user);
  }

  @Get('statements/mine/year/:year')
  @Roles(Role.RESIDENT)
  myStatement(
    @Param('year') year: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UnitYearStatement> {
    return this.exportsService.myUnitStatement(year, user);
  }

  @Get('invoices/:id/receipt.html')
  @Roles(Role.ADMIN, Role.RESIDENT)
  async receipt(
    @Param('id') invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    const file = await this.exportsService.receiptHtml(invoiceId, user);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(file.filename)}"`,
    );
    return file.body;
  }
}
