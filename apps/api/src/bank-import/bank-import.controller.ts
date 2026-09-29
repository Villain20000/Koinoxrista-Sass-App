import {
  Body,
  Controller,
  Param,
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
import { ApplyBankImportDto, PreviewBankCsvDto } from './dto/bank-import.dto';
import { BankImportService } from './bank-import.service';

@Controller('buildings/:buildingId/bank-import')
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class BankImportController {
  constructor(private readonly bankImportService: BankImportService) {}

  @Post('preview')
  @Roles(Role.ADMIN)
  preview(
    @Param('buildingId') buildingId: string,
    @Body() dto: PreviewBankCsvDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankImportService.preview(buildingId, user, dto.csv);
  }

  @Post('apply')
  @Roles(Role.ADMIN)
  apply(
    @Param('buildingId') buildingId: string,
    @Body() dto: ApplyBankImportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bankImportService.apply(buildingId, user, dto);
  }
}
