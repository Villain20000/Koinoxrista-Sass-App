import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
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
import { CreateMeterDto } from './dto/create-meter.dto';
import { UpsertMeterReadingDto } from './dto/upsert-meter-reading.dto';
import { MetersService } from './meters.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class MetersController {
  constructor(private readonly metersService: MetersService) {}

  @Get('buildings/:buildingId/meters')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.metersService.list(buildingId, user);
  }

  @Post('buildings/:buildingId/meters')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateMeterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.metersService.create(buildingId, dto, user);
  }

  @Delete('meters/:id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.metersService.remove(id, user);
  }

  /** Upserts one reading per meter and period. */
  @Post('meters/:id/readings')
  @Roles(Role.ADMIN)
  upsertReading(
    @Param('id') id: string,
    @Body() dto: UpsertMeterReadingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.metersService.upsertReading(id, dto, user);
  }

  /** Matrix view data for the readings-entry grid (units × kinds). */
  @Get('buildings/:buildingId/meters/readings')
  @Roles(Role.ADMIN)
  readingsMatrix(
    @Param('buildingId') buildingId: string,
    @Query('period') period: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.metersService.readingsMatrix(buildingId, period, user);
  }

  /** Per-unit consumed values used by the METERS allocation strategy. */
  @Get('buildings/:buildingId/meters/consumption')
  @Roles(Role.ADMIN)
  consumption(
    @Param('buildingId') buildingId: string,
    @Query('period') period: string | undefined,
    @Query('kind') kind: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.metersService.consumption(buildingId, period, kind, user);
  }
}
