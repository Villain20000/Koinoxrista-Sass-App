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
import { CreateBankConnectionDto } from './dto/create-bank-connection.dto';
import { OpenBankingService } from './openbanking.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class OpenBankingController {
  constructor(private readonly openBankingService: OpenBankingService) {}

  @Post('buildings/:buildingId/bank-connections')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateBankConnectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openBankingService.createConnection(buildingId, user, dto);
  }

  @Get('buildings/:buildingId/bank-connections')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openBankingService.listConnections(buildingId, user);
  }

  @Post('bank-connections/:id/sync')
  @Roles(Role.ADMIN)
  sync(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.openBankingService.sync(id, user);
  }

  @Get('bank-connections/:id/transactions')
  @Roles(Role.ADMIN)
  transactions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.openBankingService.listTransactions(id, user);
  }

  @Delete('bank-connections/:id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.openBankingService.deleteConnection(id, user);
  }
}
