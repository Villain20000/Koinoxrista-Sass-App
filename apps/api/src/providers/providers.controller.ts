import {
  Controller,
  Get,
  Param,
  Query,
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
import { SearchProvidersQueryDto } from './dto/search-providers.query';
import { ProvidersService } from './providers.service';

// The directory is intentionally tenant-independent: it lists providers
// across ALL buildings so both managers and residents can discover them.
@Controller('providers')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.RESIDENT)
  search(@Query() query: SearchProvidersQueryDto) {
    return this.providersService.search(query);
  }

  @Get(':userId')
  @Roles(Role.ADMIN, Role.RESIDENT)
  detail(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.providersService.detail(userId, user.role);
  }
}
