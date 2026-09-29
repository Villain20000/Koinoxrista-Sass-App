import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { UpdateSupplierPaymentDto } from './dto/update-supplier-payment.dto';
import { PayoutsService } from './payouts.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get('buildings/:buildingId/payouts')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @Query('year') year: string | undefined,
    @Query('jobId') jobId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payoutsService.list(
      buildingId,
      user,
      this.yearOf(year),
      jobId || undefined,
    );
  }

  @Get('buildings/:buildingId/payouts/summary')
  @Roles(Role.ADMIN)
  summary(
    @Param('buildingId') buildingId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payoutsService.summary(buildingId, user, this.yearOf(year));
  }

  @Post('buildings/:buildingId/payouts')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateSupplierPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payoutsService.create(buildingId, dto, user);
  }

  @Patch('payouts/:id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payoutsService.update(user.buildingId ?? '', id, dto, user);
  }

  @Delete('payouts/:id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.payoutsService.remove(user.buildingId ?? '', id, user);
  }

  @Get('payouts/mine')
  @Roles(Role.PROVIDER)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.payoutsService.mine(user);
  }

  /** Parses a `year` query param; undefined falls back to service defaults. */
  private yearOf(year: string | undefined): number | undefined {
    if (!year) return undefined;
    const parsed = Number(year);
    return Number.isInteger(parsed) && parsed > 1970 ? parsed : undefined;
  }
}
