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
import { CreatePartnerLeadDto } from './dto/create-partner-lead.dto';
import { LeadStatusDto } from './dto/lead-status.dto';
import { UpdatePartnerLeadDto } from './dto/update-partner-lead.dto';
import { PartnersService } from './partners.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get('buildings/:buildingId/partner-leads')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @Query('status') status: string | undefined,
    @Query('category') category: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnersService.list(buildingId, user, { status, category });
  }

  @Get('buildings/:buildingId/partner-leads/summary')
  @Roles(Role.ADMIN)
  summary(
    @Param('buildingId') buildingId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnersService.summary(buildingId, user, this.yearOf(year));
  }

  @Post('buildings/:buildingId/partner-leads')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreatePartnerLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnersService.create(buildingId, dto, user);
  }

  @Patch('partner-leads/:id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerLeadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnersService.update(id, dto, user);
  }

  @Post('partner-leads/:id/status')
  @Roles(Role.ADMIN)
  changeStatus(
    @Param('id') id: string,
    @Body() dto: LeadStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.partnersService.changeStatus(id, dto, user);
  }

  @Delete('partner-leads/:id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.partnersService.remove(id, user);
  }

  /** Parses a `year` query param; undefined falls back to service defaults. */
  private yearOf(year: string | undefined): number | undefined {
    if (!year) return undefined;
    const parsed = Number(year);
    return Number.isInteger(parsed) && parsed > 1970 ? parsed : undefined;
  }
}
