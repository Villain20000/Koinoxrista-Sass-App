import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
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
import { ChangeTierDto } from './dto/change-tier.dto';
import { ActivateSubscriptionDto } from './dto/activate-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @Roles(Role.ADMIN)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.getOrCreate(this.buildingIdOf(user));
  }

  @Put('tier')
  @Roles(Role.ADMIN, Role.PLATFORM_ADMIN)
  changeTier(
    @Body() dto: ChangeTierDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptionsService.changeTier(
      this.buildingIdOf(user),
      dto,
      user,
    );
  }

  @Post('activate')
  @Roles(Role.ADMIN)
  activate(
    @Body() dto: ActivateSubscriptionDto | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // Optional body carries the referral code captured at /register?ref=…
    return this.subscriptionsService.activatePeriod(
      this.buildingIdOf(user),
      dto?.referralCode,
    );
  }

  @Post('cancel')
  @Roles(Role.ADMIN)
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.cancel(this.buildingIdOf(user));
  }

  @Get('features')
  @Roles(Role.ADMIN)
  features(@CurrentUser() user: AuthenticatedUser) {
    return this.subscriptionsService.features(this.buildingIdOf(user));
  }

  private buildingIdOf(user: AuthenticatedUser): string {
    if (!user.buildingId) {
      throw new ForbiddenException('User is not linked to a building');
    }
    return user.buildingId;
  }
}
