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
import { AttendanceToggleDto } from './dto/attendance-toggle.dto';
import { CreateAgendaItemDto } from './dto/create-agenda-item.dto';
import { UpdateAgendaItemDto } from './dto/update-agenda-item.dto';
import { AssemblyService } from './assembly.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssemblyController {
  constructor(private readonly assemblyService: AssemblyService) {}

  @Get('votes/:voteId/agenda')
  @Roles(Role.ADMIN)
  agenda(
    @Param('voteId') voteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assemblyService.listAgenda(voteId, user);
  }

  @Post('votes/:voteId/agenda')
  @Roles(Role.ADMIN)
  appendAgenda(
    @Param('voteId') voteId: string,
    @Body() dto: CreateAgendaItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assemblyService.appendAgendaItem(voteId, dto, user);
  }

  @Patch('agenda/:id')
  @Roles(Role.ADMIN)
  updateAgenda(
    @Param('id') id: string,
    @Body() dto: UpdateAgendaItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assemblyService.updateAgendaItem(id, dto, user);
  }

  @Delete('agenda/:id')
  @Roles(Role.ADMIN)
  removeAgenda(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assemblyService.removeAgendaItem(id, user);
  }

  @Get('votes/:voteId/attendance')
  @Roles(Role.ADMIN)
  attendance(
    @Param('voteId') voteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assemblyService.getAttendance(voteId, user);
  }

  @Post('votes/:voteId/attendance')
  @Roles(Role.ADMIN)
  toggleAttendance(
    @Param('voteId') voteId: string,
    @Body() dto: AttendanceToggleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assemblyService.toggleAttendance(voteId, dto, user);
  }

  @Get('votes/:voteId/praktiko')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  praktiko(
    @Param('voteId') voteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assemblyService.getPraktiko(voteId, user);
  }

  @Get('votes/:voteId/praktiko/draft')
  @Roles(Role.ADMIN, Role.BUILDING_OWNER)
  draftPraktiko(
    @Param('voteId') voteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.assemblyService.draftPraktiko(voteId, user);
  }
}
