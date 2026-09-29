import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AccountantGuard } from './accountant.guard';
import { AccountantSeatService } from './accountant-seat.service';

/**
 * READ-ONLY financial views for ACCOUNTANT seats. Per-building access is
 * verified against `AccountantAccess` inside the service on every call.
 */
@Controller('accountant')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, AccountantGuard)
export class AccountantReadController {
  constructor(private readonly accountantSeatService: AccountantSeatService) {}

  @Get('buildings')
  listBuildings(@CurrentUser() user: AuthenticatedUser) {
    return this.accountantSeatService.listBuildings(user);
  }

  @Get('buildings/:buildingId/summary')
  summary(
    @Param('buildingId') buildingId: string,
    @Query('months') months: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountantSeatService.summary(buildingId, user, months);
  }

  @Get('buildings/:buildingId/statements')
  statement(
    @Param('buildingId') buildingId: string,
    @Query('year') year: string | undefined,
    @Query('unitId') unitId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!year || !unitId) {
      throw new BadRequestException('year and unitId are required');
    }
    return this.accountantSeatService.statement(buildingId, year, unitId, user);
  }

  @Get('buildings/:buildingId/payouts-summary')
  payoutsSummary(
    @Param('buildingId') buildingId: string,
    @Query('year') yearRaw: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const year = parseYear(yearRaw) ?? new Date().getUTCFullYear();
    return this.accountantSeatService.payoutsSummary(buildingId, year, user);
  }

  /** Late/outstanding charges (aging report) — read-only. */
  @Get('buildings/:buildingId/arrears')
  arrears(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountantSeatService.arrearsReport(buildingId, user);
  }

  @Get('buildings/:buildingId/apologismos')
  apologismos(
    @Param('buildingId') buildingId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountantSeatService.apologismos(buildingId, year, user);
  }
}

function parseYear(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!/^\d{4}$/.test(raw)) {
    throw new BadRequestException('year must match YYYY');
  }
  return Number(raw);
}
