import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
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
import { AddNoteDto } from './dto/add-note.dto';
import { AdvanceStageDto } from './dto/advance-stage.dto';
import { CloseCaseDto } from './dto/close-case.dto';
import { CreateLegalCaseDto } from './dto/create-case.dto';
import { LegalService } from './legal.service';

interface HeaderResponse {
  setHeader(name: string, value: string): this;
}

@Controller('buildings/:buildingId/legal')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Get('stats')
  @Roles(Role.ADMIN)
  getStats(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalService.getStats(buildingId, user);
  }

  @Get('cases')
  @Roles(Role.ADMIN)
  listCases(
    @Param('buildingId') buildingId: string,
    @Query('stage') stage: string | undefined,
    @Query('status') status: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalService.listCases(buildingId, stage, status, user);
  }

  @Get('cases/:id/exodik')
  @Roles(Role.ADMIN)
  async getExodik(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    const html = await this.legalService.getExodikHtml(buildingId, id, user);
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    return html;
  }

  @Get('cases/:id')
  @Roles(Role.ADMIN)
  getCase(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalService.getCase(buildingId, id, user);
  }

  @Post('cases')
  @Roles(Role.ADMIN)
  createCase(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateLegalCaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalService.createCase(buildingId, dto, user);
  }

  @Post('cases/:id/send-notice')
  @Roles(Role.ADMIN)
  sendNotice(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalService.sendNotice(buildingId, id, user);
  }

  @Post('cases/:id/advance')
  @Roles(Role.ADMIN)
  advance(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: AdvanceStageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const nextStage = dto.nextStage ?? dto.stage;
    return this.legalService.advanceStage(buildingId, id, nextStage as string, user);
  }

  @Post('cases/:id/note')
  @Roles(Role.ADMIN)
  addNote(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: AddNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalService.addNote(buildingId, id, dto.note, user);
  }

  @Post('cases/:id/close')
  @Roles(Role.ADMIN)
  close(
    @Param('buildingId') buildingId: string,
    @Param('id') id: string,
    @Body() dto: CloseCaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalService.closeCase(buildingId, id, dto.reason, user);
  }
}
