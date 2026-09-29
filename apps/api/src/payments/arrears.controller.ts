import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ArrearsService } from './arrears.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ArrearsController {
  constructor(private readonly arrearsService: ArrearsService) {}

  @Get('buildings/:buildingId/arrears')
  @Roles(Role.ADMIN)
  arrears(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.arrearsService.getArrears(buildingId, user);
  }
}
