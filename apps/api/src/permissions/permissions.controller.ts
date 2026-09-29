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
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PERMISSION_KEYS, PermissionsService } from './permissions.service';

class SetPermissionsDto {
  @IsArray()
  @ArrayMinSize(0)
  @IsString({ each: true })
  keys!: string[];
}

@Controller('buildings/:buildingId/permissions')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('admins')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  listAdmins(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.permissionsService.listAdmins(buildingId, user);
  }

  @Post('admins/:userId')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  setPermissions(
    @Param('buildingId') buildingId: string,
    @Param('userId') userId: string,
    @Body() dto: SetPermissionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.permissionsService.setPermissions(buildingId, userId, dto.keys, user);
  }

  @Get('keys')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  listKeys() {
    return PERMISSION_KEYS;
  }
}