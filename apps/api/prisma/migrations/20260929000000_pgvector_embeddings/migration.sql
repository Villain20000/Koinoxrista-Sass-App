-- Phase 1 (docs/LANGCHAIN_LANGGRAPH_PLAN.md): pgvector RAG foundation.
-- Managed with raw SQL because Prisma has no native `vector` column support;
-- schema.prisma mirrors the table with an `Unsupported("vector(1024)?")` field.

CREATE TABLE "EmbeddingChunk" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmbeddingChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmbeddingChunk_buildingId_sourceType_sourceId_chunkIndex_key" ON "EmbeddingChunk"("buildingId", "sourceType", "sourceId", "chunkIndex");

CREATE INDEX "EmbeddingChunk_buildingId_idx" ON "EmbeddingChunk"("buildingId");

-- The `embedding` vector(1024) column, the pgvector extension and the HNSW
-- index are NOT created here: they would fail on a plain postgres:16 image
-- (type `vector` does not exist). EmbeddingsService.ensureReady() self-heals
-- them at runtime (CREATE EXTENSION / ADD COLUMN IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS) and degrades gracefully when pgvector is unavailable. To fix
-- a deployment that started on plain postgres and later switched to
-- pgvector/pgvector:pg16, restart the API (superuser role) or run manually:
--   CREATE EXTENSION IF NOT EXISTS vector;
--   ALTER TABLE "EmbeddingChunk" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
--
-- NOTE for `prisma migrate dev`: schema.prisma declares the `embedding` field as
-- Unsupported("vector(1024)?") but this migration never creates that column, so
-- Prisma will propose a follow-up migration adding it. That is expected — apply
-- it on the pgvector image (docker-compose.yml) where the `vector` type exists.
-- The shadow database replays this migration cleanly (no pgvector dependency).

ALTER TABLE "EmbeddingChunk" ADD CONSTRAINT "EmbeddingChunk_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;
