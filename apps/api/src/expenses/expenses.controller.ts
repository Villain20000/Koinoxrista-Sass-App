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

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpensesService } from './expenses.service';

@Controller('buildings/:buildingId/expenses')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expensesService.create(buildingId, dto, user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.RESIDENT)
  list(
    @Param('buildingId') buildingId: string,
    @Query('periodYearMonth') periodYearMonth: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expensesService.list(buildingId, periodYearMonth, user);
  }
}
