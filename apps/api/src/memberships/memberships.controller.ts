import { Controller, Get, UseGuards } from '@nestjs/common';

import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MembershipsService } from './memberships.service';

@Controller('memberships')
@UseGuards(JwtAuthGuard)
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.memberships.listForUser(user.id);
  }
}
