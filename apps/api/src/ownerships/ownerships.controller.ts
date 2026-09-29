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

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateOwnershipDto } from './dto/create-ownership.dto';
import { OwnershipsService } from './ownerships.service';

@Controller('units/:unitId/ownerships')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class OwnershipsController {
  constructor(private readonly ownershipsService: OwnershipsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Param('unitId') unitId: string,
    @Body() dto: CreateOwnershipDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ownershipsService.create(unitId, dto, user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.RESIDENT)
  list(
    @Param('unitId') unitId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ownershipsService.listForUnit(unitId, user);
  }
}
