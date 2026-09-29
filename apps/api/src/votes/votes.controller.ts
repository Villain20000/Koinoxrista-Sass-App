import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CastBallotDto } from './dto/cast-ballot.dto';
import { CreateVoteDto } from './dto/create-vote.dto';
import { VotesService } from './votes.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class VotesController {
  constructor(private readonly votesService: VotesService) {}

  @Post('buildings/:buildingId/votes')
  @Roles(Role.ADMIN)
  create(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateVoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.votesService.create(buildingId, dto, user);
  }

  @Get('buildings/:buildingId/votes')
  @Roles(Role.ADMIN, Role.RESIDENT)
  list(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.votesService.list(buildingId, user);
  }

  @Get('votes/:voteId')
  @Roles(Role.ADMIN, Role.RESIDENT)
  get(
    @Param('voteId') voteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.votesService.get(voteId, user);
  }

  @Post('votes/:voteId/ballots')
  @Roles(Role.RESIDENT)
  cast(
    @Param('voteId') voteId: string,
    @Body() dto: CastBallotDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.votesService.castBallot(voteId, dto, user);
  }

  @Post('votes/:voteId/close')
  @Roles(Role.ADMIN)
  close(
    @Param('voteId') voteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.votesService.close(voteId, user);
  }

  @Get('votes/:voteId/ballots')
  @Roles(Role.ADMIN)
  ballots(
    @Param('voteId') voteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.votesService.listBallots(voteId, user);
  }
}
