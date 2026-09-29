import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  InspectionsService,
  InspectionResult,
} from './inspections.service';

class CreateInspectionDto {
  @IsOptional()
  @IsString()
  inspectedAt?: string;

  @IsIn(['OK', 'NG', 'REPAIR_NEEDED'])
  result!: InspectionResult;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  photoKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  jobId?: string;
}

class CostQueryDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  min?: number;
}

@Controller('buildings/:buildingId/assets/:assetId/inspections')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class InspectionsController {
  constructor(private readonly inspectionsService: InspectionsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.BUILDING_OWNER, Role.PROVIDER, Role.RESIDENT)
  list(
    @Param('buildingId') buildingId: string,
    @Param('assetId') assetId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inspectionsService.list(buildingId, assetId, user);
  }

  @Post()
  @Roles(Role.ADMIN, Role.BUILDING_OWNER, Role.PROVIDER)
  create(
    @Param('buildingId') buildingId: string,
    @Param('assetId') assetId: string,
    @Body() dto: CreateInspectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inspectionsService.create(buildingId, assetId, dto, user);
  }

  @Get('cost')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  cost(
    @Param('buildingId') buildingId: string,
    @Param('assetId') assetId: string,
    @Body() dto: CostQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inspectionsService.assetCost(buildingId, assetId, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  remove(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inspectionsService.remove(buildingId, id, user);
  }
}