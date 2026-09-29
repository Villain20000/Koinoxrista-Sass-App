import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { ImportBuildingDto } from './dto/import-building.dto';
import { TransferService } from './transfer.service';

/** Minimal structural response (avoids a hard @types/express dependency). */
interface HeaderResponse {
  setHeader(name: string, value: string): this;
}

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Get('buildings/:buildingId/transfer/export')
  @Roles(Role.ADMIN)
  async export(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    const payload = await this.transferService.exportBuilding(buildingId, user);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="building-export.json"',
    );
    return payload;
  }

  @Post('transfer/import')
  @Roles(Role.ADMIN)
  import(
    @Body() dto: ImportBuildingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.transferService.importBuilding(dto.payload, user);
  }
}
