import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AlertMetric, KpiService } from './kpi.service';

class UpsertRuleDto {
  @IsIn(['COLLECTION_RATE', 'ARREARS_WOW', 'DEFECTS_7D', 'PSP_FAILURES'])
  metric!: AlertMetric;

  @IsNumber()
  threshold!: number;

  @IsOptional()
  @IsString()
  window?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@Controller('buildings/:buildingId/kpi')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class KpiController {
  constructor(private readonly kpiService: KpiService) {}

  @Get('snapshots')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  snapshots(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('weeks') weeks?: string,
  ) {
    const parsed = weeks ? Number(weeks) : 12;
    return this.kpiService.list(buildingId, user, Number.isFinite(parsed) ? parsed : 12);
  }

  @Post('snapshot')
  @HttpCode(200)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  snapshot(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kpiService.snapshot(buildingId);
  }

  @Post('backfill')
  @HttpCode(200)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  backfill(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kpiService.backfill(buildingId).then((count) => ({ backfilled: count }));
  }

  @Get('rules')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  rules(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kpiService.listRules(buildingId, user);
  }

  @Put('rules')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  upsertRule(
    @Param('buildingId') buildingId: string,
    @Body() dto: UpsertRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kpiService.upsertRule(buildingId, dto, user);
  }

  @Post('check-anomalies')
  @HttpCode(200)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  checkAnomalies(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kpiService.checkAnomalies(buildingId, user);
  }

  @Get('forecast')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  forecast(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kpiService.forecastArrears(buildingId, user);
  }
}