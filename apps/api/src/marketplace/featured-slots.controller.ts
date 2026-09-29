import {
  Body,
  Controller,
  Delete,
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
import { FeaturedSlotsService } from './featured-slots.service';
import { CreateFeaturedSlotDto } from './dto/create-featured-slot.dto';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class FeaturedSlotsController {
  constructor(private readonly featuredSlots: FeaturedSlotsService) {}

  @Get('buildings/:buildingId/featured-slots')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuredSlots.list(buildingId, user);
  }

  @Post('buildings/:buildingId/featured-slots')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateFeaturedSlotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuredSlots.create(buildingId, dto, user);
  }

  @Delete('buildings/:buildingId/featured-slots/:id')
  @Roles(Role.ADMIN)
  remove(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.featuredSlots.remove(buildingId, id, user);
  }
}
