import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { CreateBudgetLineDto } from './dto/create-budget-line.dto';
import { UpdateBudgetLineDto } from './dto/update-budget-line.dto';
import { BudgetsService } from './budgets.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get('buildings/:buildingId/budgets/:year/compare')
  @Roles(Role.ADMIN)
  compare(
    @Param('buildingId') buildingId: string,
    @Param('year', ParseIntPipe) year: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.budgetsService.compare(buildingId, year, user);
  }

  @Get('buildings/:buildingId/budgets/:year')
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @Param('year', ParseIntPipe) year: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.budgetsService.list(buildingId, year, user);
  }

  @Post('buildings/:buildingId/budgets')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateBudgetLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.budgetsService.create(buildingId, dto, user);
  }

  @Patch('budgets/:id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBudgetLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.budgetsService.update(id, dto, user);
  }

  @Delete('budgets/:id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.budgetsService.remove(id, user);
  }
}
