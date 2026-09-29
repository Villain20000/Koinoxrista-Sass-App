import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { UpdateBuildingSettingsDto } from './dto/update-building-settings.dto';

@Controller('buildings')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateBuildingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.buildingsService.create(dto, user);
  }

  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.buildingsService.findMine(user);
  }

  /** Update per-building settings (適格請求書 registration number). */
  @Patch(':buildingId/settings')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  updateSettings(
    @Param('buildingId') buildingId: string,
    @Body() dto: UpdateBuildingSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.buildingsService.updateSettings(buildingId, dto, user);
  }
}
