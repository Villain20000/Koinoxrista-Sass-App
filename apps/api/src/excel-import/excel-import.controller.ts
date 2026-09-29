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
import { ExcelImportService } from './excel-import.service';
import { ImportUnitsDto } from './dto/import-units.dto';

@Controller()
@UsePipes(new ValidationPipe({ whitelist: true }))
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExcelImportController {
  constructor(private readonly excelImportService: ExcelImportService) {}

  @Post('buildings/:buildingId/import-units')
  @Roles(Role.ADMIN)
  importUnits(
    @Param('buildingId') buildingId: string,
    @Body() dto: ImportUnitsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.excelImportService.importUnits(buildingId, dto, user);
  }
}
