import {
  Controller,
  Body,
  ForbiddenException,
  Get,
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
import { GenerateMyDataDto } from './dto/generate-mydata.dto';
import { ReconcileMyDataDto } from './dto/reconcile-mydata.dto';
import { MyDataService } from './mydata.service';

/** Minimal structural response (avoids a hard @types/express dependency). */
interface HeaderResponse {
  setHeader(name: string, value: string): this;
}

@Controller('mydata')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class MyDataController {
  constructor(private readonly myDataService: MyDataService) {}

  @Post('generate')
  @Roles(Role.ADMIN)
  generate(
    @Body() dto: GenerateMyDataDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.myDataService.generateForPeriod(
      this.buildingIdOf(user),
      dto.periodYearMonth,
    );
  }

  @Post('reconcile')
  @Roles(Role.ADMIN)
  reconcile(
    @Body() dto: ReconcileMyDataDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.myDataService.reconcile(
      this.buildingIdOf(user),
      dto.periodYearMonth,
    );
  }

  @Get()
  @Roles(Role.ADMIN)
  list(
    @Query('periodYearMonth') periodYearMonth: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.myDataService.listForPeriod(
      this.buildingIdOf(user),
      periodYearMonth,
    );
  }

  @Get('xml')
  @Roles(Role.ADMIN)
  async xml(
    @Query('periodYearMonth') periodYearMonth: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    const file = await this.myDataService.xmlForPeriod(
      this.buildingIdOf(user),
      periodYearMonth,
    );
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    return file.body;
  }

  private buildingIdOf(user: AuthenticatedUser): string {
    if (!user.buildingId) {
      throw new ForbiddenException('User is not attached to a building');
    }
    return user.buildingId;
  }
}
