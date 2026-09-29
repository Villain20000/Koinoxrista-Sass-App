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
import { CreateInviteDto } from './dto/create-invite.dto';
import { InvitesService } from './invites.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Get('buildings/:buildingId/invites')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.list(buildingId, user);
  }

  @Post('buildings/:buildingId/invites')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.create(buildingId, dto, user);
  }

  @Delete('invites/:id')
  @Roles(Role.ADMIN)
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.invitesService.revoke(id, user);
    return { deleted: true };
  }
}
