import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateRecurringExpenseDto } from './dto/create-recurring.dto';
import { GenerateRecurringDto } from './dto/generate-recurring.dto';
import { UpdateRecurringExpenseDto } from './dto/update-recurring.dto';
import { RecurringService } from './recurring.service';

@Controller('buildings/:buildingId/recurring')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecurringController {
  constructor(private readonly recurringService: RecurringService) {}

  @Get()
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recurringService.list(buildingId, user);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateRecurringExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recurringService.create(buildingId, dto, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRecurringExpenseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recurringService.update(buildingId, id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recurringService.remove(buildingId, id, user);
  }

  @Post('generate')
  @Roles(Role.ADMIN)
  generate(
    @Param('buildingId') buildingId: string,
    @Body() dto: GenerateRecurringDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.recurringService.generate(buildingId, dto.periodYearMonth, user);
  }
}
