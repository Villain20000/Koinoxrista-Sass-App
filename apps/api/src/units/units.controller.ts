import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
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
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { UnitsService } from './units.service';

@Controller('buildings/:buildingId/units')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.RESIDENT)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.unitsService.listForBuilding(buildingId, user);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateUnitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.unitsService.create(buildingId, dto, user);
  }

  @Put(':unitId')
  @Roles(Role.ADMIN)
  update(
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.unitsService.update(buildingId, unitId, dto, user);
  }

  @Delete(':unitId')
  @Roles(Role.ADMIN)
  async remove(
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.unitsService.remove(buildingId, unitId, user);
    return { deleted: true };
  }
}
