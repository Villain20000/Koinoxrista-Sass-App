import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Body,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RunInvoicesDto } from './dto/run-invoices.dto';
import { InvoicesService } from './invoices.service';

@Controller('buildings/:buildingId/invoices')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('run')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  run(
    @Param('buildingId') buildingId: string,
    @Body() dto: RunInvoicesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.run(buildingId, dto, user);
  }

  @Get()
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @Query('periodYearMonth') periodYearMonth: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.listAdmin(buildingId, periodYearMonth, user);
  }
}

@Controller('invoices')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class MyInvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get('mine')
  @Roles(Role.RESIDENT)
  mine(
    @Query('periodYearMonth') periodYearMonth: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.findMine(periodYearMonth, user);
  }
}
