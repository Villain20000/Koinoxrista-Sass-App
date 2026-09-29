import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { MarkDoneDto } from './dto/mark-done.dto';
import { MaintenanceService } from './maintenance.service';

@Controller('buildings/:buildingId/assets')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class BuildingAssetsController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get()
  @Roles(Role.ADMIN)
  listAssets(
    @Param('buildingId') buildingId: string,
    @Query('category') category: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.listAssets(buildingId, user, category);
  }

  @Post()
  @Roles(Role.ADMIN)
  createAsset(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.createAsset(buildingId, dto, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  updateAsset(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.updateAsset(buildingId, id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  deleteAsset(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.deleteAsset(buildingId, id, user);
  }
}

@Controller('buildings/:buildingId/maintenance')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Get('schedules')
  @Roles(Role.ADMIN)
  listSchedules(
    @Param('buildingId') buildingId: string,
    @Query('upcomingDays') upcomingDays: string | undefined,
    @Query('category') category: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.listSchedules(buildingId, user, { upcomingDays, category });
  }

  @Post('schedules')
  @Roles(Role.ADMIN)
  createSchedule(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.createSchedule(buildingId, dto, user);
  }

  @Patch('schedules/:id')
  @Roles(Role.ADMIN)
  updateSchedule(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.updateSchedule(buildingId, id, dto, user);
  }

  @Delete('schedules/:id')
  @Roles(Role.ADMIN)
  deleteSchedule(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.deleteSchedule(buildingId, id, user);
  }

  @Post('schedules/:id/done')
  @Roles(Role.ADMIN)
  markDone(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: MarkDoneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.markDone(buildingId, id, dto, user);
  }

  @Post('generate-jobs')
  @Roles(Role.ADMIN)
  generateJobs(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.generateDueJobs(buildingId, user);
  }

  @Get('calendar')
  @Roles(Role.ADMIN)
  getCalendar(
    @Param('buildingId') buildingId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.maintenanceService.getCalendar(buildingId, user, { from, to });
  }
}
