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

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ContributionDto } from './dto/contribution.dto';
import { CreateLevyDto } from './dto/create-levy.dto';
import { UpdateReserveTargetDto } from './dto/create-reserve-fund.dto';
import { DrawdownDto } from './dto/drawdown.dto';
import { ReserveService } from './reserve.service';

@Controller('buildings/:buildingId/reserve')
@UsePipes(
  new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
)
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReserveController {
  constructor(private readonly reserve: ReserveService) {}

  // -------------------------------------------------------------------------
  // Fund
  // -------------------------------------------------------------------------

  @Get('fund')
  @Roles(Role.ADMIN)
  getFund(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.getOrCreateFund(buildingId, user);
  }

  @Patch('target')
  @Roles(Role.ADMIN)
  updateTarget(
    @Param('buildingId') buildingId: string,
    @Body() dto: UpdateReserveTargetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.updateTarget(buildingId, dto.targetCents, user);
  }

  @Post('contribute')
  @Roles(Role.ADMIN)
  contribute(
    @Param('buildingId') buildingId: string,
    @Body() dto: ContributionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.contribute(buildingId, dto, user);
  }

  @Post('drawdown')
  @Roles(Role.ADMIN)
  drawdown(
    @Param('buildingId') buildingId: string,
    @Body() dto: DrawdownDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.drawdown(buildingId, dto, user);
  }

  // -------------------------------------------------------------------------
  // Levies
  // -------------------------------------------------------------------------

  @Get('levies')
  @Roles(Role.ADMIN)
  listLevies(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.listLevies(buildingId, user);
  }

  @Post('levies')
  @Roles(Role.ADMIN)
  createLevy(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateLevyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.createLevy(buildingId, dto, user);
  }

  @Get('levies/:id')
  @Roles(Role.ADMIN)
  getLevy(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.getLevyDetail(buildingId, id, user);
  }

  @Post('levies/:id/issue')
  @Roles(Role.ADMIN)
  issueLevy(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.issueLevy(buildingId, id, user);
  }

  @Post('levies/:id/close')
  @Roles(Role.ADMIN)
  closeLevy(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reserve.closeLevy(buildingId, id, user);
  }
}
