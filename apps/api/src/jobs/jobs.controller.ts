import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
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
import { CreateBidDto } from './dto/create-bid.dto';
import { CreateDefectDto } from './dto/create-defect.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateWorkLogDto } from './dto/create-work-log.dto';
import { RateBidDto } from './dto/rate-bid.dto';
import { UpsertProviderProfileDto } from './dto/provider-profile.dto';
import { JobsService } from './jobs.service';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('buildings/:buildingId/jobs')
  @Roles(Role.ADMIN)
  createJob(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateJobDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.createJob(buildingId, dto, user);
  }

  @Post('buildings/:buildingId/defects')
  @Roles(Role.RESIDENT, Role.ADMIN)
  createDefect(
    @Param('buildingId') buildingId: string,
    @Body() dto: CreateDefectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.createDefect(buildingId, dto, user);
  }

  @Get('buildings/:buildingId/jobs')
  @Roles(Role.ADMIN, Role.RESIDENT)
  listForBuilding(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.listForBuilding(buildingId, user);
  }

  @Get('jobs/marketplace')
  @Roles(Role.PROVIDER)
  marketplace() {
    return this.jobsService.marketplace();
  }

  @Get('jobs/mine')
  @Roles(Role.PROVIDER)
  myBids(@CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.myBids(user.id);
  }

  @Post('jobs/:jobId/bids')
  @Roles(Role.PROVIDER)
  createBid(
    @Param('jobId') jobId: string,
    @Body() dto: CreateBidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.createBid(jobId, dto, user);
  }

  @Get('jobs/:jobId/bids')
  @Roles(Role.ADMIN)
  listBids(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.listBids(jobId, user);
  }

  @Post('bids/:bidId/accept')
  @Roles(Role.ADMIN)
  acceptBid(
    @Param('bidId') bidId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.acceptBid(bidId, user);
  }

  @Post('bids/:bidId/reject')
  @Roles(Role.ADMIN)
  rejectBid(
    @Param('bidId') bidId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.rejectBid(bidId, user);
  }

  @Post('jobs/:jobId/work-logs')
  @Roles(Role.PROVIDER)
  addWorkLog(
    @Param('jobId') jobId: string,
    @Body() dto: CreateWorkLogDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.addWorkLog(jobId, dto, user);
  }

  @Get('jobs/:jobId/work-logs')
  listWorkLogs(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.listWorkLogs(jobId, user);
  }

  @Post('jobs/:jobId/convert')
  @Roles(Role.ADMIN)
  convertToRfp(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.convertToRfp(jobId, user);
  }

  @Post('jobs/:jobId/complete')
  @Roles(Role.ADMIN)
  completeJob(
    @Param('jobId') jobId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.completeJob(jobId, user);
  }

  @Post('jobs/:jobId/rating')
  @Roles(Role.ADMIN)
  rateAcceptedBid(
    @Param('jobId') jobId: string,
    @Body() dto: RateBidDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.rateAcceptedBid(jobId, dto, user);
  }

  @Get('provider/profile')
  @Roles(Role.PROVIDER)
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.getProviderProfile(user.id);
  }

  @Put('provider/profile')
  @Roles(Role.PROVIDER)
  upsertProfile(
    @Body() dto: UpsertProviderProfileDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.jobsService.upsertProviderProfile(user.id, dto);
  }
}
