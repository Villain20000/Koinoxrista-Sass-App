import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SchedulerJobType, SchedulerService } from './scheduler.service';

class TriggerJobDto {
  @IsIn(['invoice_run', 'recurring_gen', 'late_fee', 'reminders', 'maintenance_jobs', 'compliance_check', 'vote_close'])
  jobType!: SchedulerJobType;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must match YYYY-MM' })
  period?: string;
}

@Controller('admin/scheduler')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get('runs')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  history(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 50;
    return this.schedulerService.history(Number.isFinite(parsed) ? parsed : 50);
  }

  @Post('trigger')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  async trigger(@Body() dto: TriggerJobDto) {
    await this.schedulerService.trigger(dto.jobType, dto.period);
    return { accepted: true };
  }
}