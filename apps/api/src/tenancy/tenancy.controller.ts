import {
  Body,
  Controller,
  Get,
  Param,
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
import { SetOccupancyDto } from './dto/set-occupancy.dto';
import { UpsertEligibilityRuleDto } from './dto/upsert-rule.dto';
import { TenancyService } from './tenancy.service';

@Controller('buildings/:buildingId')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('occupancy/:unitId')
  @Roles(Role.ADMIN)
  getOccupants(
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenancy.getUnitOccupants(buildingId, unitId, user);
  }

  @Put('occupancy/:unitId')
  @Roles(Role.ADMIN)
  setOccupancy(
    @Param('buildingId') buildingId: string,
    @Param('unitId') unitId: string,
    @Body() dto: SetOccupancyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenancy.setOccupancy(buildingId, unitId, dto, user);
  }

  @Get('eligibility-rules')
  @Roles(Role.ADMIN)
  getRules(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenancy.getEligibilityRules(buildingId, user);
  }

  @Put('eligibility-rules')
  @Roles(Role.ADMIN)
  upsertRule(
    @Param('buildingId') buildingId: string,
    @Body() dto: UpsertEligibilityRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenancy.upsertRule(buildingId, dto, user);
  }

  @Get('votes/:voteId/eligibility/:unitId')
  @Roles(Role.ADMIN)
  checkCanVote(
    @Param('buildingId') buildingId: string,
    @Param('voteId') voteId: string,
    @Param('unitId') unitId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tenancy.checkCanVote(buildingId, voteId, unitId, user);
  }
}
