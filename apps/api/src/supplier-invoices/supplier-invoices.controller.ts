import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateManualSupplierInvoiceDto } from './dto/create-manual.dto';
import { ListSupplierInvoicesQueryDto } from './dto/list-query.dto';
import { MatchSupplierInvoiceDto } from './dto/match.dto';
import { SupplierInvoicesService } from './supplier-invoices.service';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

@Controller('buildings/:buildingId/supplier-invoices')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupplierInvoicesController {
  constructor(private readonly supplierInvoices: SupplierInvoicesService) {}

  @Get()
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @Query() query: ListSupplierInvoicesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.list(buildingId, query as any, user);
  }

  @Get('stats')
  @Roles(Role.ADMIN)
  stats(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.getStats(buildingId, user);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  getById(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.getById(buildingId, id, user);
  }

  @Post('manual')
  @Roles(Role.ADMIN)
  manual(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateManualSupplierInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.importManual(buildingId, dto, user);
  }

  @Post('import-json')
  @Roles(Role.ADMIN)
  // For import-json we allow arbitrary myDATA JSON; disable whitelist to preserve fields
  @UsePipes(new ValidationPipe({ whitelist: false, transform: true }))
  importJson(
    @Param('buildingId') buildingId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.importFromJson(buildingId, body, user);
  }

  @Post('import-pdf')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PDF_BYTES },
    }),
  )
  importPdf(
    @Param('buildingId') buildingId: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.importFromPdf(buildingId, file as any, user);
  }

  @Post('pull-mydata')
  @Roles(Role.ADMIN)
  pullMyData(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.pullFromMyData(buildingId, user);
  }

  @Post(':id/match')
  @Roles(Role.ADMIN)
  match(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: MatchSupplierInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.matchToExpense(buildingId, id, dto?.expenseId, user);
  }

  @Post(':id/void')
  @Roles(Role.ADMIN)
  void(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supplierInvoices.voidInvoice(buildingId, id, user);
  }
}
