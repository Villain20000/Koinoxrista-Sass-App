import { Body, Controller, Get, Param, Put, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';

@Controller('buildings/:buildingId/branding')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class BrandingAdminController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get()
  @Roles(Role.ADMIN)
  get(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.brandingService.get(buildingId, user);
  }

  @Put()
  @Roles(Role.ADMIN)
  update(
    @Param('buildingId') buildingId: string,
    @Body() dto: UpdateBrandingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.brandingService.update(buildingId, dto, user);
  }
}

/**
 * PUBLIC branding endpoint — intentionally guard-free (no JwtAuthGuard), the
 * established mechanism for unauthenticated routes (see the PSP webhook in
 * payments.controller.ts): JwtAuthGuard is applied per-controller via
 * @UseGuards and only ThrottlerGuard is registered globally. Serves display
 * fields only; never the reserved customDomain.
 */
@Controller('public/buildings/:buildingId/branding')
@UsePipes(new ValidationPipe({ whitelist: true }))
export class PublicBrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get()
  getPublic(@Param('buildingId') buildingId: string) {
    return this.brandingService.getPublic(buildingId);
  }
}
