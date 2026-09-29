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
import { CreateComplianceDto } from './dto/create-compliance.dto';
import { UpdateComplianceDto } from './dto/update-compliance.dto';
import { ComplianceService } from './compliance.service';

@Controller('buildings/:buildingId/compliance')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class BuildingComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get()
  @Roles(Role.ADMIN)
  list(
    @Param('buildingId') buildingId: string,
    @Query('kind') kind: string | undefined,
    @Query('upcomingDays') upcomingDays: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complianceService.list(buildingId, user, { kind, upcomingDays });
  }

  @Post()
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateComplianceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complianceService.create(buildingId, dto, user);
  }

  @Post('check-expiries')
  @Roles(Role.ADMIN)
  checkExpiries(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complianceService.checkExpiries(buildingId, user);
  }
}

@Controller('compliance')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class ComplianceItemController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateComplianceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complianceService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.complianceService.remove(id, user);
  }
}
