import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import {
  ApiKeyScope,
  CurrentApiKey,
} from './decorators/current-api-key.decorator';
import type { ApiKeyPrincipal } from './decorators/current-api-key.decorator';

@Controller('public/v1')
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  constructor(private readonly publicApiService: PublicApiService) {}

  @Get('invoices')
  @ApiKeyScope('invoices:read')
  invoices(
    @Query('periodYearMonth') periodYearMonth: string | undefined,
    @CurrentApiKey() apiKey: ApiKeyPrincipal,
  ) {
    return this.publicApiService.invoices(apiKey.buildingId, periodYearMonth);
  }

  @Get('payments/summary')
  @ApiKeyScope('payments:read')
  paymentsSummary(@CurrentApiKey() apiKey: ApiKeyPrincipal) {
    return this.publicApiService.paymentsSummary(apiKey.buildingId);
  }

  @Get('votes/results')
  @ApiKeyScope('votes:read')
  voteResults(@CurrentApiKey() apiKey: ApiKeyPrincipal) {
    return this.publicApiService.voteResults(apiKey.buildingId);
  }
}
