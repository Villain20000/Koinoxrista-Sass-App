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
import { IsOptional, IsString } from 'class-validator';
import { Throttle } from '@nestjs/throttler';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { assertSameBuilding } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterOpenDto, VerifyEmailDto } from './dto/open-registration.dto';
import { OpenRegistrationService } from './open-registration.service';

class ApproveDto {
  @IsOptional()
  @IsString()
  unitId?: string;
}

const openThrottle = {
  default: { limit: 5, ttl: 60 * 60 * 1000, name: 'default' },
};

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
export class OpenRegistrationController {
  constructor(
    private readonly openRegistrationService: OpenRegistrationService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('auth/register-open')
  @HttpCode(201)
  @Throttle(openThrottle)
  registerOpen(@Body() dto: RegisterOpenDto) {
    return this.openRegistrationService.registerOpen(dto);
  }

  @Post('auth/verify-email')
  @HttpCode(200)
  @Throttle(openThrottle)
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.openRegistrationService.verifyEmail(dto.token);
  }

  @Get('buildings/:buildingId/registration/join-code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  async getJoinCode(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ joinCode: string }> {
    assertSameBuilding(user, buildingId);
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { joinCode: true },
    });
    return { joinCode: building?.joinCode ?? '' };
  }

  @Post('buildings/:buildingId/registration/join-code/regenerate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  regenerateJoinCode(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openRegistrationService.regenerateJoinCode(buildingId, user);
  }

  @Get('buildings/:buildingId/registration/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  listPending(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openRegistrationService.listPending(buildingId, user);
  }

  @Post('buildings/:buildingId/registration/approve/:userId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  approve(
    @Param('buildingId') buildingId: string,
    @Param('userId') userId: string,
    @Body() dto: ApproveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openRegistrationService.approve(buildingId, userId, user, dto.unitId);
  }

  @Post('buildings/:buildingId/registration/reject/:userId')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  reject(
    @Param('buildingId') buildingId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openRegistrationService.reject(buildingId, userId, user);
  }
}