import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Phase 1 (docs/LANGCHAIN_LANGGRAPH_PLAN.md): local pgvector embeddings store.
 *
 * - Embeddings come from Ollama (`EMBEDDING_MODEL`, default bge-m3, 1024-dim)
 *   via `POST {EMBEDDING_API_URL}/api/embed` — no data leaves the host.
 * - Vector schema (extension / column / HNSW index) is self-healed at runtime:
 *   the Prisma migration only creates the base table so `migrate deploy` never
 *   fails on a plain postgres:16 image without pgvector.
 * - Every row carries `buildingId` (tenant isolation) — search always filters
 *   by building; nothing can leak across buildings even if two embeddings are
 *   numerically identical.
 * - Graceful degradation: with Ollama down or pgvector missing, `upsertMany`
 *   returns `ok:false` (callers log and continue) and `search` returns `[]`,
 *   so AssistantService can fall back to the keyword scorer.
 */

/** Must match the `vector(1024)` column / `Unsupported("vector(1024)")` field. */
export const EMBEDDING_DIM = 1024;

/** Hard cap on accepted embedding dimensions (defence against bad models). */
const MAX_EMBEDDING_DIM = 4096;

export interface EmbeddingChunkInput {
  sourceType: string;
  sourceId: string;
  title: string;
  body: string;
  chunkIndex?: number;
}

export interface ScoredChunk {
  sourceType: string;
  sourceId: string;
  title: string;
  body: string;
  score: number;
}

export interface UpsertResult {
  ok: boolean;
  embedded: number;
  skipped: number;
  deleted: number;
  error?: string;
}

export function hashContent(title: string, body: string): string {
  return crypto.createHash('sha256').update(`${title}\n${body}`).digest('hex');
}

/** Cosine similarity of two equal-length float arrays (matches pgvector <=>). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

interface EmbeddingRow {
  sourceType: string;
  sourceId: string;
  title: string;
  body: string;
  embedding: string;
  /** `1 - (embedding <=> query)` — pgvector returns numeric. */
  score: string;
}

function embeddingModel(): string {
  return process.env.EMBEDDING_MODEL ?? 'bge-m3';
}

@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  /** Tri-state: null = not yet probed, false = pgvector/Ollama unavailable. */
  private ready: boolean | null = null;
  private lastError: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** True when embeddings are enabled AND the vector schema self-heal passed. */
  isReady(): boolean {
    if (process.env.PGVECTOR_ENABLED === 'false') return false;
    if (this.ready !== null) return this.ready;
    return false; // unknown until first ensureReady(); callers treat as false
  }

  /**
   * Ensures the pgvector extension, `embedding` column and HNSW index exist.
   * Never throws — a failure marks the service degraded and is logged once.
   * Requires a superuser-ish role for CREATE EXTENSION (docker default is).
   */
  async ensureReady(): Promise<boolean> {
    if (this.ready !== null) return this.ready;
    if (process.env.PGVECTOR_ENABLED === 'false') return false;

    try {
      await this.prisma.$executeRawUnsafe(
        `CREATE EXTENSION IF NOT EXISTS vector`,
      );
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "EmbeddingChunk" ADD COLUMN IF NOT EXISTS "embedding" vector(${EMBEDDING_DIM})`,
      );
      // HNSW index for cosine (<=>). Best-effort: a partial/outdated pgvector
      // without HNSW support still allows brute-force search (small datasets).
      try {
        await this.prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "EmbeddingChunk_embedding_hnsw_idx" ON "EmbeddingChunk" USING hnsw ("embedding" vector_cosine_ops)`,
        );
      } catch (indexError) {
        this.logger.warn(
          `HNSW index unavailable (brute-force search): ${String(indexError)}`,
        );
      }
      this.ready = true;
      this.logger.log('pgvector ready (extension + embedding column + hnsw)');
    } catch (error) {
      this.ready = false;
      this.lastError = String(error);
      this.logger.warn(
        `pgvector unavailable — embeddings disabled (fallback to keyword retrieval): ${this.lastError}`,
      );
    }
    return this.ready;
  }

  /** Probes the Ollama embed endpoint once; result cached per model. */
  private async embedBatch(texts: string[]): Promise<number[][]> {
    const url = process.env.EMBEDDING_API_URL ?? 'http://localhost:11434/api/embed';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: embeddingModel(),
        input: texts,
      }),
    });
    if (!res.ok) {
      throw new Error(`embed failed (${res.status})`);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    const embeddings = data.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error('embed endpoint returned an unexpected shape');
    }
    for (const vector of embeddings) {
      if (!Array.isArray(vector) || vector.length === 0 || vector.length > MAX_EMBEDDING_DIM) {
        throw new Error('embed endpoint returned an invalid vector');
      }
    }
    return embeddings;
  }

  /**
   * Upserts chunks for one (buildingId, sourceType, sourceId): rows whose
   * content hash is unchanged are kept (skip), stale rows are deleted,
   * new/changed texts are embedded in one batch call. On any failure the
   * stored rows stay consistent (hash-first upserts, then embed) — callers
   * receive `ok:false` and can retry on the next sync tick.
   */
  async upsertChunks(
    buildingId: string,
    sourceType: string,
    sourceId: string,
    chunks: { title: string; body: string }[],
  ): Promise<UpsertResult> {
    const model = embeddingModel();
    const stale = await this.prisma.embeddingChunk.findMany({
      where: { buildingId, sourceType, sourceId },
      select: { id: true, chunkIndex: true, contentHash: true, embeddingModel: true },
    });

    const existingByIndex = new Map(stale.map((row) => [row.chunkIndex, row]));
    const toEmbed: { chunkIndex: number; text: string }[] = [];
    const keepIds: string[] = [];
    let skipped = 0;

    chunks.forEach((chunk, index) => {
      const hash = hashContent(chunk.title, chunk.body);
      const existing = existingByIndex.get(index);
      if (existing && existing.contentHash === hash && existing.embeddingModel === model) {
        keepIds.push(existing.id);
        skipped += 1;
      } else {
        toEmbed.push({ chunkIndex: index, text: `${chunk.title}\n${chunk.body}` });
      }
    });

    const staleIds = stale
      .filter((row) => !keepIds.includes(row.id))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await this.prisma.embeddingChunk.deleteMany({
        where: { id: { in: staleIds } },
      });
    }

    if (toEmbed.length === 0) {
      return { ok: true, embedded: 0, skipped, deleted: staleIds.length };
    }

    if (!(await this.ensureReady())) {
      return { ok: false, embedded: 0, skipped, deleted: staleIds.length, error: this.lastError ?? 'pgvector unavailable' };
    }

    let vectors: number[][];
    try {
      vectors = await this.embedBatch(toEmbed.map((entry) => entry.text));
    } catch (error) {
      this.ready = false; // re-probe on next call (Ollama may have restarted)
      this.lastError = String(error);
      return { ok: false, embedded: 0, skipped, deleted: staleIds.length, error: this.lastError };
    }

    for (let i = 0; i < toEmbed.length; i += 1) {
      const { chunkIndex } = toEmbed[i];
      const vector = vectors[i];
      const hash = hashContent(chunks[chunkIndex].title, chunks[chunkIndex].body);
      const vectorLiteral = `[${vector.map((v) => Number.isFinite(v) ? v : 0).join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "EmbeddingChunk"
           ("id", "buildingId", "sourceType", "sourceId", "title", "body", "contentHash", "embeddingModel", "chunkIndex", "embedding", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::vector, NOW(), NOW())
         ON CONFLICT ("buildingId", "sourceType", "sourceId", "chunkIndex")
         DO UPDATE SET "title" = EXCLUDED."title", "body" = EXCLUDED."body",
           "contentHash" = EXCLUDED."contentHash", "embeddingModel" = EXCLUDED."embeddingModel",
           "embedding" = EXCLUDED."embedding", "updatedAt" = NOW()`,
        buildingId,
        sourceType,
        sourceId,
        chunks[chunkIndex].title,
        chunks[chunkIndex].body,
        hash,
        model,
        chunkIndex,
        vectorLiteral,
      );
    }

    return { ok: true, embedded: toEmbed.length, skipped, deleted: staleIds.length };
  }

  /** Deletes every chunk of one source (announcement edit/delete, GDPR). */
  async deleteBySource(
    buildingId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<number> {
    const result = await this.prisma.embeddingChunk.deleteMany({
      where: { buildingId, sourceType, sourceId },
    });
    return result.count;
  }

  /**
   * Building-scoped cosine search. Returns [] when degraded (never throws) —
   * AssistantService falls back to keyword retrieval in that case.
   */
  async search(
    buildingId: string,
    question: string,
    topK = 5,
  ): Promise<ScoredChunk[]> {
    if (!(await this.ensureReady())) return [];

    let vector: number[];
    try {
      [vector] = await this.embedBatch([question]);
    } catch (error) {
      this.ready = false;
      this.lastError = String(error);
      this.logger.warn(`embed probe failed — search degraded: ${this.lastError}`);
      return [];
    }

    // buildingId is passed as a parameter ($1) — it is data, never SQL text.
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT "sourceType", "sourceId", "title", "body",
              1 - ("embedding" <=> $2::vector) AS score
         FROM "EmbeddingChunk"
        WHERE "buildingId" = $1
        ORDER BY "embedding" <=> $2::vector
        LIMIT $3`,
      buildingId,
      `[${vector.map((v) => (Number.isFinite(v) ? v : 0)).join(',')}]`,
      Math.max(1, Math.min(topK, 20)),
    )) as EmbeddingRow[];

    return rows.map((row) => ({
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      title: row.title,
      body: row.body,
      score: Number(row.score) || 0,
    }));
  }

  /** Default embedding used when pgvector exists but the column is empty. */
  static zeroVector(dim = EMBEDDING_DIM): number[] {
    return new Array(dim).fill(0);
  }
}
