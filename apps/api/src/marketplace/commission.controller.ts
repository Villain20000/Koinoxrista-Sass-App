import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
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
import { CommissionsService } from './commission.service';
import { ListCommissionsQueryDto } from './dto/list-commissions.query';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  @Get('buildings/:buildingId/commissions')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @Query() query: ListCommissionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commissions.list(buildingId, user, query.status);
  }

  @Get('buildings/:buildingId/commissions/summary')
  @Roles(Role.ADMIN)
  summary(
    @Param('buildingId') buildingId: string,
    @Query('year', new DefaultValuePipe(new Date().getUTCFullYear()), ParseIntPipe)
    year: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commissions.summary(buildingId, year, user);
  }

  @Post('commissions/:id/mark-paid')
  @Roles(Role.ADMIN)
  markPaid(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.commissions.markPaid(id, user);
  }

  @Post('commissions/:id/waive')
  @Roles(Role.ADMIN)
  waive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.commissions.waive(id, user);
  }
}
