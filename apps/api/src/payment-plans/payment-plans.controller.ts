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
import { CreatePaymentPlanDto } from './dto/create-payment-plan.dto';
import { RecordPlanPaymentDto } from './dto/record-plan-payment.dto';
import { PaymentPlansService } from './payment-plans.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentPlansController {
  constructor(private readonly paymentPlansService: PaymentPlansService) {}

  @Post('buildings/:buildingId/payment-plans')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreatePaymentPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentPlansService.create(buildingId, dto, user);
  }

  @Get('buildings/:buildingId/payment-plans')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @Query('status') status: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentPlansService.list(buildingId, user, status || undefined);
  }

  /** Full schedule of one plan with running totals. */
  @Get('payment-plans/:id')
  @Roles(Role.ADMIN)
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentPlansService.get(id, user);
  }

  @Post('payment-plans/:id/payments')
  @Roles(Role.ADMIN)
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPlanPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.paymentPlansService.recordPayment(id, dto, user);
  }

  @Post('payment-plans/:id/cancel')
  @Roles(Role.ADMIN)
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentPlansService.cancel(id, user);
  }

  /** RESIDENT read-only view of their own unit's active plan. */
  @Get('balance/payment-plan')
  @Roles(Role.RESIDENT)
  myActivePlan(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentPlansService.myActivePlan(user);
  }
}
