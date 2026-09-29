import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { classifyDefectText } from './defect-classifier';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssistantService } from './assistant.service';
import { assertSameBuilding } from '../common/tenant';

class AssistantQueryDto {
  @IsString()
  @MinLength(4)
  @MaxLength(1000)
  question!: string;
}

class ClassifyDefectDto {
  @IsString()
  @MinLength(4)
  @MaxLength(2000)
  text!: string;
}

const assistantThrottle = {
  default: { limit: 10, ttl: 24 * 60 * 60 * 1000 }, // 10 / day / user
};

@Controller('buildings/:buildingId/assistant')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('query')
  @HttpCode(200)
  @Roles(Role.RESIDENT, Role.ADMIN, Role.BUILDING_OWNER)
  @Throttle(assistantThrottle)
  query(
    @Param('buildingId') buildingId: string,
    @Body() dto: AssistantQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assistantService.query(buildingId, dto.question, user);
  }

  @Post('classify-defect')
  @HttpCode(200)
  @Roles(Role.RESIDENT, Role.ADMIN, Role.BUILDING_OWNER)
  @Throttle(assistantThrottle)
  classifyDefect(
    @Param('buildingId') buildingId: string,
    @Body() dto: ClassifyDefectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    // Local Greek classifier — no LLM, no data leaves the host.
    const result = classifyDefectText(dto.text);
    return {
      ...result,
      buildingId,
      redacted: dto.text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').slice(0, 2000),
    };
  }
}