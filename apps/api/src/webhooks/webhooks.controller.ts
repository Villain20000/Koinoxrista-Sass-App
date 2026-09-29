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
import { IsArray, IsBoolean, IsOptional, IsString, IsUrl, MinLength, ArrayMinSize } from 'class-validator';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Throttle } from '@nestjs/throttler';
import { routes } from '../security/throttle.config';
import { WebhooksService } from './webhooks.service';

class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events!: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

const webhookThrottle = {
  default: { limit: routes.webhook.limit, ttl: routes.webhook.ttlMs },
};

@Controller('buildings/:buildingId/webhooks')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooksService.list(buildingId, user);
  }

  @Post()
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateWebhookDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooksService.create(buildingId, dto, user);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  remove(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooksService.remove(buildingId, id, user);
  }

  @Get('deliveries')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  deliveries(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.webhooksService.deliveries(buildingId, user);
  }
}

/** Signature verification endpoint for external reporters (PSP etc). */
@Controller('webhooks/fire')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class WebhookFireController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post(':buildingId/:event')
  @HttpCode(202)
  @Throttle(webhookThrottle)
  async fire(
    @Param('buildingId') buildingId: string,
    @Param('event') event: string,
    @Body() payload: unknown,
  ) {
    void this.webhooksService.dispatch(buildingId, event, payload);
    return { accepted: true };
  }
}