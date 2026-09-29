import {
  Controller,
  Get,
  Param,
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
import { ReferralsService } from './referrals.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('buildings/:buildingId/referrals')
  @Roles(Role.ADMIN, Role.PLATFORM_ADMIN)
  info(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referralsService.info(buildingId, user);
  }

  @Post('buildings/:buildingId/referrals/rotate-code')
  @Roles(Role.ADMIN)
  rotateCode(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.referralsService.rotateCode(buildingId, user);
  }
}
