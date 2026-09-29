import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { CreateTreasuryAccountDto } from './dto/create-treasury-account.dto';
import { CreateTreasuryEntryDto } from './dto/create-treasury-entry.dto';
import { TreasuryService } from './treasury.service';

@Controller('buildings/:buildingId/treasury')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class TreasuryController {
  constructor(private readonly treasury: TreasuryService) {}

  // -------------------------------------------------------------------------
  // Accounts
  // -------------------------------------------------------------------------

  @Get('accounts')
  @Roles(Role.ADMIN)
  listAccounts(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treasury.listAccounts(buildingId, user);
  }

  @Post('accounts')
  @Roles(Role.ADMIN)
  createAccount(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateTreasuryAccountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treasury.createAccount(buildingId, dto, user);
  }

  // -------------------------------------------------------------------------
  // Entries
  // -------------------------------------------------------------------------

  @Get('entries')
  @Roles(Role.ADMIN)
  listEntries(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.treasury.listEntries(buildingId, user, {
      accountId: accountId || undefined,
      from: from || undefined,
      to: to || undefined,
      skip: skip || undefined,
      take: take || undefined,
    });
  }

  @Post('entries')
  @Roles(Role.ADMIN)
  createEntry(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateTreasuryEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treasury.createEntry(buildingId, dto, user);
  }

  // -------------------------------------------------------------------------
  // Balance / KPIs
  // -------------------------------------------------------------------------

  @Get('balance')
  @Roles(Role.ADMIN)
  getBalance(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.treasury.getBalance(buildingId, user);
  }
}
