import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { ExpenseCategoriesService } from './expense-categories.service';

@Controller('buildings/:buildingId/categories')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpenseCategoriesController {
  constructor(
    private readonly expenseCategoriesService: ExpenseCategoriesService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateExpenseCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenseCategoriesService.create(buildingId, dto, user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.RESIDENT)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenseCategoriesService.list(buildingId, user);
  }
}
