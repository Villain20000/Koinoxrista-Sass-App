# LangChain + LangGraph Orchestration Plan (PolykatoikiaOS)

> Goal: replace the hand-rolled RAG/agent logic in `apps/api/src/assistant/*` with a
> **LangGraph.js graph** running fully local (Ollama LLM + Ollama embeddings + pgvector)
> so every AI flow is a testable, auditable, building-scoped state machine.
> Companion doc: `docs/AI_LOCAL_FEATURES_GR.md` (model choices, Greek-market features,
> rollout phases). This doc covers the **orchestration layer** only.

---

## 1. Why LangChain / LangGraph here

Current state (audited):

| Concern | Today | Problem |
|---|---|---|
| RAG retrieval | `assistant.service.ts` `retrieve()` — keyword-overlap scoring | Misses Greek morphology; no semantic search; pgvector planned but absent |
| NL→SQL | `nl-sql.service.ts` — regex templates + one LLM shot | No self-correction loop when SQL is rejected/fails |
| Provider routing | `llm-provider.ts` `createLlmProvider()` | Works — keep it |
| Defect triage | `defect-classifier.ts` keywords | No few-shot LLM path, no fallback chain |

LangGraph gives us: explicit graph state, conditional edges (retrieve → grade → rewrite →
generate), retry/self-correction loops, and per-node checkpoints — all in TypeScript
inside the existing NestJS process. **No Python sidecar, no new service.**

| Choice | Decision | Rationale |
|---|---|---|
| Language | **LangGraph.js** (`@langchain/langgraph`) | Same process as NestJS API; shared `PrismaService`, `AuditService`, tenant guards |
| LLM runtime | **Ollama** via `@langchain/ollama` (`ChatOllama`) | Already the local default (`LLM_API_URL`, `meltemi:7b`); keeps `AI_LOCAL_ONLY` guarantee |
| Embeddings | **OllamaEmbeddings** (`bge-m3`, 1024-dim, Greek+English) | One runtime for chat + embed; `EMBEDDING_MODEL` env already reserved |
| Vector DB | **pgvector** on the existing Postgres 16 | No new infra; `buildingId` column keeps tenant isolation; covered by `backup.yml` |
| Tracing | **None by default**; optional self-hosted Langfuse later | LangSmith is hosted — conflicts with `AI_LOCAL_ONLY` / GDPR posture |

⚠️ Prisma does not support the `vector` column type natively → manage vector schema and
queries with raw SQL migrations + `prisma.$queryRaw` (pattern already used in
`nl-sql.service.ts`).

---

## 2. Target architecture

```
Angular client ──▶ NestJS AssistantController
                        │
                        ▼
              AssistantService (feature flag: RAG_ENGINE=langgraph | keyword)
                        │
                        ▼
        ┌────── LangGraph StateGraph<GraphState> ──────┐
        │  load_context ─▶ retrieve ─▶ grade_docs      │
        │        ▲              (conditional)          │
        │        │            ├─ relevant ─▶ generate │
        │        └─ rewrite_query ◀─ not_relevant      │
        │  generate ─▶ guard_answer (hallucination +   │
        │               citation check) ─▶ return      │
        └──────────────────────────────────────────────┘
             │                    │
     ChatOllama (meltemi)   PGVectorStore (bge-m3)
     via LlmProvider        WHERE buildingId = $1
```

Everything still flows through `LLM_PROVIDER` for the leaf calls where possible, and
every graph run writes an `audit.record` (same as today).

### Graph state (illustrative)

```ts
interface GraphState {
  buildingId: string;
  question: string;          // PII-redacted before entry
  rewrittenQuestion?: string;
  documents: SourceChunk[];  // { type, title, body, score }
  attempt: number;           // rewrite loop guard (max 2)
  answer?: string;
}
```

### Nodes

1. **load_context** — fetch pinned announcements + FAQ statics (deterministic, cheap).
2. **retrieve** — PGVectorStore similarity search, `filter: { buildingId }`, top-k=5.
3. **grade_docs** — LLM grades each chunk relevant/irrelevant (cheap structured output).
4. **rewrite_query** — Greek query rewrite for morphology/synonyms; loops back once.
5. **generate** — the existing Greek system prompt from `assistant.service.ts:47`.
6. **guard_answer** — regex + heuristic check: answer must cite a source title or the
   honest `δεν βρέθηκε` phrase; otherwise force fallback answer.

---

## 3. Packages

```bash
pnpm --filter api add @langchain/core @langchain/ollama @langchain/community @langchain/pgvector @langchain/langgraph
pnpm --filter api add -D @langchain/langgraph-checkpoint
```

> Not yet installed — Phase 1 is dependency-free (native `fetch` to Ollama's
> `/api/embed`), so CI and the bundle stay untouched until the LangGraph RAG graph
> lands in Phase 2.

- `@langchain/ollama` — `ChatOllama`, `OllamaEmbeddings` (OpenAI-compatible too, but the
  dedicated Ollama client handles keep-alive/context better).
- `@langchain/pgvector` — `PGVectorStore` with a Prisma-managed pool or `pg` Pool.
- `@langchain/langgraph` — `StateGraph`, `Annotation`, memory saver (per-building thread
  ids if we add multi-turn later).

New env (append to `.env.example`; mirror §1 of `AI_LOCAL_FEATURES_GR.md`):

```env
RAG_ENGINE="langgraph"            # langgraph | keyword (keyword = today's behavior)
EMBEDDING_API_URL="http://localhost:11434/api/embed"
RAG_TOP_K="5"
RAG_MAX_REWRITES="1"
LANGGRAPH_CHECKPOINT_DB=""        # empty = in-memory; else Postgres URL for checkpoints
LANGFUSE_PUBLIC_KEY=""            # optional self-hosted tracing only
LANGFUSE_SECRET_KEY=""
LANGFUSE_BASE_URL=""
```

---

## 4. Implementation phases

### Phase 1 — pgvector + embeddings pipeline (week 1–2) — ✅ DONE (2026-09-29)
1. ~~Raw SQL migration~~ **Done**: `20260929000000_pgvector_embeddings` creates the
   `EmbeddingChunk` table (Prisma-convention PK/index/FK, `buildingId` FK CASCADE).
   The `vector` extension, `embedding vector(1024)` column and HNSW index are
   **self-healed at runtime** by `EmbeddingsService.ensureReady()` so `migrate deploy`
   never fails on a plain postgres:16 image; docker-compose now uses `pgvector/pgvector:pg16`.
2. **Done**: `apps/api/src/assistant/embeddings.service.ts` — Ollama `/api/embed`
   embedder (`EMBEDDING_MODEL`, default bge-m3), hash-dedupe upserts
   (`ON CONFLICT (buildingId, sourceType, sourceId, chunkIndex)`), building-scoped
   cosine search (`WHERE buildingId = $1`), delete-by-source for GDPR.
3. **Done**: `embeddings-ingestion.service.ts` + on-write hooks in
   `AnnouncementsService` (create/update-text/delete, fire-and-forget) and a weekly
   `embeddings_sync` cron (`@Cron('0 11 * * 1')`) with JobRun idempotency + admin
   endpoints `GET/POST .../assistant/embeddings/(status|sync)`, `DELETE .../source/...`.
   Sources: announcements, compliance notes, expense-category strategies, FAQ sections.
4. Acceptance met: unit tests with a fake embedder (no Ollama in CI) — graceful
   degradation (`PGVECTOR_ENABLED=false`, Ollama down, extension missing) covered;
   full `api:test` suite green (1154 tests). Tenant-isolation e2e pending Phase 2.

### Phase 2 — LangGraph RAG graph behind a flag (week 2–4)
1. `apps/api/src/assistant/graphs/rag.graph.ts` — nodes/edges as in §2; every LLM leaf
   call goes through the injected `LlmProvider` (so console mock still works in tests).
2. `AssistantService.query()` branches on `RAG_ENGINE`: `langgraph` → invoke graph;
   `keyword` → existing code path untouched.
3. Keep the tenant guarantee: `assertSameBuilding` before graph entry; vector filter
   `buildingId` asserted by a dedicated spec (`otherBuilding → 0 chunks`).
4. Acceptance: golden-set harness (§8 of `AI_LOCAL_FEATURES_GR.md`) — with Ollama up,
   ≥80% of the 50 Greek Q&A answered with a citation; `keyword` mode unchanged and green.

### Phase 3 — Agent graphs for existing features (week 4–8)
| Graph | Replaces | Notes |
|---|---|---|
| `nl-sql.graph.ts` | one-shot LLM in `nl-sql.service.ts` | nodes: translate → validate (`isSelectOnly` + `containsBuildingFilter`) → execute → on error, self-correct once with the DB error message; rate limit + audit unchanged |
| `defect-classify.graph.ts` | `defect-classifier.ts` keywords | few-shot Greek examples; keyword classifier stays as node 0 (fast path), LLM only when score is low |
| `praktiko-draft` | direct call | same prompt, but with revision loop vs structured facts; admin publish flow per `AI_LOCAL_FEATURES_GR.md` §9.4 |

### Phase 4 — Streaming + multi-turn (week 8+)
- SSE endpoint (`/api/assistant/stream`) using graph `.stream()` events; Angular UI
  renders partial tokens; audit on final event only.
- Multi-turn memory: thread per `(buildingId, userId, conversationId)`; store checkpoints
  in Postgres if `LANGGRAPH_CHECKPOINT_DB` set. Context window guarded by
  `AI_TOKEN_BUDGET_PER_BUILDING` enforcement (§9.1 of `AI_LOCAL_FEATURES_GR.md`).

---

## 5. Guardrails (non-negotiable, inherited from existing code)

- **Tenant isolation** — every vector row carries `building_id`; every retrieval filtered;
  e2e asserts cross-building returns nothing (404/empty, never another building's text).
- **PII redaction** — `redactPii()` runs before graph entry (emails, phones).
- **Money never LLM-computed** — amounts come from `Share`/`Invoice` rows; graphs only
  verbalize. Guard node rejects answers containing unexplained `€` figures.
- **Local-only** — `AI_LOCAL_ONLY=true` ⇒ no hosted provider construction; LangSmith
  never enabled; optional tracing is self-hosted Langfuse only.
- **Graceful degradation** — Ollama down / budget exceeded → `ConsoleLlmProvider` Greek
  fallback + FAQ links (already implemented; graph failure must not 500).
- **Audit** — one `audit.record` per graph run with `metadata: { engine: 'langgraph',
  attempt, via, sourceCount }`.

---

## 6. Testing & eval

- **Unit:** fake `ChatOllama` (scripted outputs) → test each node, conditional edges, and
  rewrite-loop max attempts. No Ollama needed.
- **Integration (local):** `docker-compose` service `ollama` + `pgvector/pgvector:pg16`;
  test tagged `@ollama` and skipped in CI unless `OLLAMA_URL` set.
- **Golden set:** extend the 50-Q Greek harness with `RAG_ENGINE=langgraph` results;
  track citation rate + honest-refusal rate in CI summary (no threshold gate initially).
- **Regression:** existing specs (`assistant.service`, `nl-sql`, `defect-classifier`,
  `llm-provider`) must stay green with `RAG_ENGINE=keyword` default in tests.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| LangGraph.js API churn (pre-1.x style releases) | Pin exact versions; wrap graph construction in one module; upgrade deliberately |
| bge-m3 quality on Greek legal terms | Keep keyword scorer as fallback path + grade node; measure on golden set before switching default |
| Graph latency > keyword path (grade+rewrite adds 2 LLM calls) | Grade with short prompts + `num_predict` cap; skip grade when top-1 similarity > 0.75; P95 budget < 2s per §6 of `AI_LOCAL_FEATURES_GR.md` |
| Ollama memory pressure on 8GB VPS (chat + embed models) | `keep_alive=-1` for embedder, chat unloaded after idle; embed in batches of 16; optional separate embed endpoint |
| Prisma/pgvector drift | Vector schema raw-SQL only; documented in `docs/RUNBOOK.md`; migration lock respected |

---

## 8. Out of scope (later)

- Python LangGraph service (only if we need Python-only integrations like advanced
  tabular ML — the arrears forecast stays local tabular per `AI_LOCAL_FEATURES_GR.md` §2.3).
- Fine-tuning / LoRA on Meltemi.
- Hosted vector DBs (Pinecone/Qdrant cloud) — pgvector keeps data on-host.

---

## 9. Immediate next steps

1. ~~Add env vars~~ Done — `EMBEDDING_API_URL` in `.env.example`.
2. ~~Phase 1 migration + `EmbeddingsService` + ingest hooks~~ **Done** (see Phase 1 above).
3. Phase 2 RAG graph + `RAG_ENGINE` flag + tenant-isolation spec.
4. Run golden set on staging (`meltemi:7b` + `bge-m3`) and record baseline numbers here.
