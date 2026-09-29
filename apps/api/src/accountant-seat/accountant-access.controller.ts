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
import { GrantAccountantDto } from './dto/grant-accountant.dto';
import { AccountantSeatService } from './accountant-seat.service';

/** ADMIN seat administration for one building's external λογιστές. */
@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccountantAccessController {
  constructor(private readonly accountantSeatService: AccountantSeatService) {}

  @Get('buildings/:buildingId/accountants')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountantSeatService.listAccesses(buildingId, user);
  }

  @Post('buildings/:buildingId/accountants')
  @Roles(Role.ADMIN)
  grant(
    @Param('buildingId') buildingId: string,
    @Body() dto: GrantAccountantDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountantSeatService.grant(buildingId, dto, user);
  }

  @Delete('buildings/:buildingId/accountants/:accessId')
  @Roles(Role.ADMIN)
  async revoke(
    @Param('buildingId') buildingId: string,
    @Param('accessId') accessId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.accountantSeatService.revoke(buildingId, accessId, user);
    return { deleted: true };
  }
}
