import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CampaignsService, CampaignAudience } from './campaigns.service';

class CreateCampaignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsIn(['ALL', 'RESIDENTS', 'ARREARS'])
  audience!: CampaignAudience;

  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @IsOptional()
  trackOpens?: boolean;
}

interface HeaderResponse {
  setHeader(name: string, value: string): this;
}

const GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/**
 * Open-tracking pixel — deliberately NO auth guard: it is loaded by email
 * clients via an <img> tag that cannot attach a Bearer token.
 */
@Controller('campaigns/:id/open.gif')
export class CampaignOpenTrackingController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  async open(
    @Param('id') id: string,
    @Query('uid') uid: string,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    if (uid) void this.campaignsService.recordOpen(id, uid);
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store');
    return GIF;
  }
}

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get('buildings/:buildingId/campaigns')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.list(buildingId, user);
  }

  @Post('buildings/:buildingId/campaigns')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateCampaignDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.create(buildingId, dto, user);
  }

  @Post('campaigns/:id/send')
  @HttpCode(200)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  send(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignsService.send(id, user);
  }

  @Get('campaigns/:id/stats')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  stats(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campaignsService.stats(id, user);
  }

  @Get('buildings/:buildingId/campaigns/preview')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  preview(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campaignsService.preview(buildingId, user);
  }

}