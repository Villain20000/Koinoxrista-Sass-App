import {
  Controller,
  Body,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ListNotificationsQueryDto,
  SubscribePushDto,
  UnsubscribePushDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.listForUser(user.id, {
      unreadOnly: Boolean(query.unread),
      skip: query.skip,
      take: query.take,
    });
  }

  @Post(':id/read')
  @HttpCode(204)
  markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(204)
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.notifications.markAllRead(user.id);
  }
}

@Controller('push/subscriptions')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard)
export class PushSubscriptionsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post()
  @HttpCode(204)
  subscribe(
    @Body() dto: SubscribePushDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.notifications.upsertSubscription(user.id, dto);
  }

  @Delete()
  @HttpCode(204)
  unsubscribe(
    @Body() dto: UnsubscribePushDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.notifications.removeSubscription(user.id, dto.endpoint);
  }
}
