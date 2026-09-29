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

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AnnouncementsService } from './announcements.service';
import { CommentDto } from './dto/comment.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post('buildings/:buildingId/announcements')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcementsService.create(buildingId, dto, user);
  }

  @Get('buildings/:buildingId/announcements')
  @Roles(Role.ADMIN)
  listAdmin(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcementsService.listAdmin(buildingId, user);
  }

  @Get('buildings/:buildingId/feed')
  @Roles(Role.ADMIN, Role.RESIDENT)
  feed(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcementsService.feed(buildingId, user);
  }

  @Patch('announcements/:id')
  @Roles(Role.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcementsService.update(id, dto, user);
  }

  @Delete('announcements/:id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.announcementsService.remove(id, user);
  }

  @Get('announcements/:id/comments')
  @Roles(Role.ADMIN, Role.RESIDENT)
  listComments(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcementsService.listComments(id, user);
  }

  @Post('announcements/:id/comments')
  @Roles(Role.ADMIN, Role.RESIDENT)
  addComment(
    @Param('id') id: string,
    @Body() dto: CommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcementsService.addComment(id, dto, user);
  }

  @Delete('announcements/:id/comments/:commentId')
  @Roles(Role.ADMIN, Role.RESIDENT)
  removeComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcementsService.removeComment(id, commentId, user);
  }
}
