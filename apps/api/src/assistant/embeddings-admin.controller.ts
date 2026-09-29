import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { assertSameBuilding } from '../common/tenant';
import { EmbeddingsIngestionService } from './embeddings-ingestion.service';
import { EmbeddingsService } from './embeddings.service';

/**
 * ADMIN endpoints for the RAG embeddings store (Phase 1):
 *  - GET    status                                → readiness + configuration
 *  - POST   sync                                  → full building sync (also
 *                                                   runs on the weekly cron)
 *  - DELETE source/:sourceType/:sourceId          → drop one source's vectors
 * BUILDING_OWNER passes implicitly (superset of ADMIN in RolesGuard).
 * No vectors or chunk bodies are ever returned — status is booleans/strings only.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('buildings/:buildingId/assistant/embeddings')
export class EmbeddingsAdminController {
  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly ingestion: EmbeddingsIngestionService,
  ) {}

  @Get('status')
  @Roles(Role.ADMIN)
  status(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    return {
      ready: this.embeddings.isReady(),
      pgvectorEnabled: process.env.PGVECTOR_ENABLED !== 'false',
      embeddingModel: process.env.EMBEDDING_MODEL ?? 'bge-m3',
    };
  }

  @Post('sync')
  @Roles(Role.ADMIN)
  sync(
    @Param('buildingId') buildingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    return this.ingestion.syncBuilding(buildingId);
  }

  @Delete('source/:sourceType/:sourceId')
  @Roles(Role.ADMIN)
  async removeSource(
    @Param('buildingId') buildingId: string,
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertSameBuilding(user, buildingId);
    const deleted = await this.embeddings.deleteBySource(buildingId, sourceType, sourceId);
    return { deleted };
  }
}
