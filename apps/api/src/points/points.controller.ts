import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PointsService } from './points.service';

class AdjustDto {
  @IsInt()
  delta!: number;

  @IsOptional()
  @IsString()
  @Max(200)
  @Min(1)
  note?: string;
}

class RedeemDto {
  @IsInt({ message: 'points must be an integer' })
  points!: number;
}

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class PointsController {
  constructor(private readonly pointsService: PointsService) {}

  @Get('points/mine')
  @Roles(Role.RESIDENT, Role.ADMIN, Role.BUILDING_OWNER)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.pointsService.mine(user);
  }

  @Post('buildings/:buildingId/points/adjust/:userId')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  adjust(
    @Param('buildingId') buildingId: string,
    @Param('userId') userId: string,
    @Body() dto: AdjustDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pointsService.adjust(buildingId, userId, dto.delta, user, dto.note);
  }

  @Post('buildings/:buildingId/points/redeem')
  @HttpCode(200)
  @Roles(Role.RESIDENT, Role.ADMIN, Role.BUILDING_OWNER)
  redeem(
    @Param('buildingId') buildingId: string,
    @Body() dto: RedeemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pointsService.redeem(buildingId, user.id, dto.points, user);
  }
}