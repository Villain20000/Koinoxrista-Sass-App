import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RunPeriodDto } from './dto/run-period.dto';
import { PlatformInvoiceService } from './platform-invoice.service';

@Controller('buildings/:buildingId/platform-invoices')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlatformInvoiceController {
  constructor(private readonly service: PlatformInvoiceService) {}

  @Get()
  @Roles(Role.ADMIN, Role.PLATFORM_ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(buildingId, user);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.PLATFORM_ADMIN)
  getOne(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.getOne(buildingId, id, user);
  }

  @Post('run-period')
  @Roles(Role.ADMIN, Role.PLATFORM_ADMIN)
  runPeriod(
    @Param('buildingId') buildingId: string,
    @Body() dto: RunPeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.runPeriod(buildingId, dto.period, user);
  }
}
