import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsOptional, IsString, Matches } from 'class-validator';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RemindersService } from './reminders.service';

class SendRemindersDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'periodYearMonth must match YYYY-MM' })
  periodYearMonth?: string;
}

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post('buildings/:buildingId/reminders/send')
  @Roles(Role.ADMIN)
  send(
    @Param('buildingId') buildingId: string,
    @Body() dto: SendRemindersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.remindersService.send(buildingId, dto.periodYearMonth, user);
  }

  @Post('buildings/:buildingId/reminders/preview')
  @Roles(Role.ADMIN)
  preview(
    @Param('buildingId') buildingId: string,
    @Body() dto: SendRemindersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.remindersService.preview(buildingId, dto.periodYearMonth, user);
  }
}
