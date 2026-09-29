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
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('api-keys')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiKeysService.create(user.buildingId, user.id, dto);
  }

  @Get()
  @Roles(Role.ADMIN)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.apiKeysService.list(user.buildingId);
  }

  @Delete(':keyId')
  @Roles(Role.ADMIN)
  revoke(
    @Param('keyId') keyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiKeysService.revoke(user.buildingId, keyId);
  }
}
