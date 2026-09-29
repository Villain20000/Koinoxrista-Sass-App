import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
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
import { RunLateFeesDto } from './dto/run-late-fees.dto';
import { UpdateLateFeeSettingsDto } from './dto/update-late-fee-settings.dto';
import { LateFeesService } from './late-fees.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class LateFeesController {
  constructor(private readonly lateFeesService: LateFeesService) {}

  @Get('buildings/:buildingId/late-fees/settings')
  @Roles(Role.ADMIN)
  settings(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lateFeesService.getSettings(buildingId, user);
  }

  @Put('buildings/:buildingId/late-fees/settings')
  @Roles(Role.ADMIN)
  updateSettings(
    @Param('buildingId') buildingId: string,
    @Body() dto: UpdateLateFeeSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lateFeesService.updateSettings(buildingId, dto, user);
  }

  @Post('buildings/:buildingId/late-fees/run')
  @Roles(Role.ADMIN)
  run(
    @Param('buildingId') buildingId: string,
    @Body() dto: RunLateFeesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lateFeesService.run(buildingId, dto, user);
  }

  @Get('buildings/:buildingId/late-fees')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lateFeesService.list(buildingId, user);
  }

  @Post('late-fees/:id/waive')
  @Roles(Role.ADMIN)
  waive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.lateFeesService.waive(id, user);
  }
}
