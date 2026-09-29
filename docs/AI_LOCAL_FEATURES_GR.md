# AI Local Features — Greek Market Plan (PolykatoikiaOS)

> Goal: best **local / on-prem** AI for Greek `polykatoikia` management — GDPR-clean (no resident financial data leaves the VPS), Greek-first language, and tuned to Greek building law. Baseline: `apps/api/src/assistant/*` with `LLM_PROVIDER` → `auto/openai/anthropic/openai-compatible` and Ollama stub (`LLM_API_URL=http://localhost:11434/v1/chat/completions`, model `llama3.1`) already in `.env.example:83-98`. This plan makes **local the default for Greece, hosted an optional fallback**.

---

## 0. Principles for Greece

1. **Data stays in the building's region.** All RAG retrieval is `buildingId`-scoped (`assistant.service.ts:44` `retrieve()`); LLM prompts are PII-redacted (names → unit labels). Local inference means no `OPENAI_API_KEY` needed for EL tenants.
2. **Greek is the primary language, not a translation.** Prompts, embeddings, and OCR must handle Greek morphology, `el-GR` dates `dd/MM/yyyy`, and legal terms (`χιλιοστά Ν.1221/1981`, `Ν.4756/2020 ασφάλιση`, `ΑΦΜ`, `myDATA/ΑΑΔΕ`).
3. **Correctness over cleverness.** Financial actions are never LLM-direct; the model proposes, the transactional service executes (`splitByLargestRemainder`, `aggregateRun`, webhook settlement). Every AI suggestion is audited (`audit.service.ts` `assistant.query`).
4. **Offline-capable.** PWA shell (`public/sw.js`) + queued push; AI queue degrades to FAQ links when token budget exceeded (see `FEATURE_PLAN.md:17`).

---

## 0b. Status vs Codebase (audited 2026-08-31)

| Plan item | Status in code | Evidence / gap |
|---|---|---|
| `LLM_PROVIDER` routing (auto/openai/anthropic/openai-compatible + console mock) | ✅ Done | `apps/api/src/assistant/llm-provider.ts:19-238` — `createLlmProvider()` with explicit-provider switch and graceful console fallback |
| `AI_LOCAL_ONLY` flag | ✅ Done | `llm-provider.ts:201` gates hosted providers (openai/anthropic disabled when true) |
| `.env.example` vars | ✅ Done | `LLM_PROVIDER`, `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL`, `AI_LOCAL_ONLY`, `AI_TOKEN_BUDGET_PER_BUILDING` all present |
| `AI_TOKEN_BUDGET_PER_BUILDING` enforcement | ❌ **Gap** | Env var exists but **no code reads it** — only `.env.example` and this doc reference it. No monthly counter, no budget check, no fallback trigger. |
| Greek RAG copilot (#1) | 🟡 Partial | `assistant.service.ts` does `buildingId`-scoped keyword-overlap retrieval (top-5 announcements + static FAQ chunk). **No embeddings/pgvector** — retrieval is lexical only. `assets/faq.el.md` exists. |
| Supplier invoice OCR (#2) | 🟡 Partial | `supplier-invoices/ocr.service.ts` is a **stub** ("Not a real OCR engine"), not Tesseract `ell`. `POST /import-pdf` + confirm/match flow exist; `issuerAfm`/VAT parsing present. |
| Arrears forecast (#3) | 🟡 Partial | `kpi.service.ts:257 forecastArrears()` exists (local tabular model, `kpi.forecast.spec.ts` green) but plan's 5-feature logistic regression + weekly scheduler wiring not built. `BuildingWeeklySnapshot` upsert exists (`kpi.service.ts:79`). |
| πρακτικό auto-draft (#4) | 🟡 Partial | `assembly/praktiko-draft.spec.ts` exists — structured praktiko + LLM draft + disclaimer. Publishing flow needs wiring. |
| Defect triage (#5) | 🟡 Partial | `assistant/defect-classifier.ts` is a **keyword classifier**, not the LLM few-shot classifier the plan describes. `jobs` `RESIDENT_REPORT`→`ADMIN_RFP` convert flow exists (`jobs.service.ts:555`). |
| NL→SQL copilot (#10), myDATA error translator (#8), voice (#9) | ❌ Not started | As planned. |
| pgvector | ❌ **Gap** | Zero occurrences in `apps/api` code or migrations — embeddings not stored. Plan assumes pgvector exists. |

---

## 1. Model & Runtime Choice (local)

| Layer | Recommendation for EL | Why |
|---|---|---|
| **LLM runtime** | **Ollama** (single binary, `ollama serve` + `ollama pull`) exposed via OpenAI-compatible `/v1/chat/completions` — already the default in `.env.example:88-92` | Zero infra, works on €40/mo Hetzner CPX31 (4 vCPU, 8GB) for 7-8B models. Alternative for heavier: `vLLM` on GPU. |
| **Greek LLM** | **Meltemi 7B Instruct v1.5** (Greek-centric, ILSP) as primary; **Llama 3.1 8B Instruct** as fallback; **Qwen2.5 7B** for function-calling | Meltemi is the only 7B with native Greek instruction tuning and EU license. Benchmark Greek MMLU; keep `llama3.1` as fallback in `llm-provider.ts: LlmProvider` routing. |
| **Embeddings** | **BGE-M3** or **E5-mistral** with Greek support, via `pgvector` on Postgres 16 (`pgvector` extension) — per `FEATURE_PLAN.md:17` RAG design | M3 handles Greek + English queries in same index; 1024-dim. Run via `ollama pull mxbai-embed-large` or local `sentence-transformers`. |
| **OCR / Vision** | **Tesseract `ell` + layout** for scanned `Τιμολόγια` + **Qwen2-VL 2B** local for photo defect reports | Supplier invoices (`SupplierInvoice.issuerAfm`) are often scanned PDFs in Greek. |
| **Vector store** | **pgvector** (`extension vector`) on the existing Postgres — no new service | Keeps tenant isolation (`buildingId` in vector rows) and backup via `.github/workflows/backup.yml`. |

Env for EL local (add to `.env.example`):

```env
LLM_PROVIDER=openai-compatible   # forces Ollama path in llm-provider.ts
LLM_API_URL=http://localhost:11434/v1/chat/completions
LLM_API_KEY=ollama
LLM_MODEL=meltemi:7b              # or llama3.1:8b
EMBEDDING_MODEL=bge-m3
EMBEDDING_API_URL=http://localhost:11434/api/embed
PGVECTOR_ENABLED=true
AI_LOCAL_ONLY=true               # new: never call hosted LLM when true (Greek default)
AI_TOKEN_BUDGET_PER_BUILDING=50000 # monthly token cap, graceful fallback to FAQ
```

---

## 2. Top 10 Local AI Features for the Greek Market (priority order)

### P0 — Ship first (month 1–2)

**1. Greek RAG Building Copilot (resident + admin) — `POST /api/assistant/query`**
- *Problem:* Same 20 questions repeat: `πώς πληρώνω`, `πότε λήγει`, `τι είναι τα χιλιοστά`. Admins answer manually.
- *Local design:* Retrieval top-k=5 from `buildingId`-scoped chunks: `Announcement` + `Expense` descriptions + static FAQ (`assets/faq.el.md` rules) + `ComplianceItem` notes. Chunk → BGE-M3 embed → `pgvector` cosine. Prompt in `assistant.service.ts:47` stays Greek `Answer in Greek, citing only provided building context`. LLM never sees cross-building rows (tenant filter tested in spec).
- *Greek tuning:* System prompt includes `Ν.1221/1981 χιλιοστά` definition; date formatter `el-GR`. Meltemi handles Greek declensions without translation layer.
- *Acceptance:* Cites source `announcement.title`; unknown → honest `δεν βρέθηκε` (no hallucination); `buildingId` filter proven by e2e cross-tenant test.
- *Metrics:* Deflection rate (copilot answers / tickets), `Sentry` on `LlmProvider` fallback to console mock.

**2. Supplier Invoice Greek OCR & Auto-fill (`SupplierInvoice` + `Expense`)**
- *Problem:* Διαχειριστές type `ΑΦΜ`, `καθαρή αξία`, `ΦΠΑ` from photos/PDFs manually; errors break `myDATA` XML (`mydata/*`).
- *Local design:* `POST /api/supplier-invoices/parse` → Tesseract `ell` + Qwen2-VL local → extract `{ issuerName, issuerAfm (9 digits), issueDate dd/MM/yyyy, netCents, vatCents, totalCents, currency }` → confirm screen (same as `bank-import` dry-run pattern). No image leaves the host.
- *Greek specifics:* `ΑΦΜ` checksum Luhn-like; `ΦΠΑ 24%/13%/6%` Greek VAT buckets; `€` vs `EUR` parsing with comma decimals `1.234,56`.
- *Acceptance:* Photo of Greek `Τιμολόγιο Παροχής Υπηρεσιών` → fields prefilled, admin confirms, then `POST /supplier-invoices` creates linked `Expense` via `supplierInvoices` module.

**3. Arrears Risk & Next-Month Forecast (local tabular model)**
- *Problem:* `buildArrears()` buckets are descriptive; admins want `ποιος κινδυνεύει να καθυστερήσει`.
- *Local design:* No LLM; a 5-feature logistic regression (on-device, `ml-regression` npm) per building: `monthsOverdue, avgDaysLate, installmentsActive, previousPaymentPlan, unitMillimes`. Trained on building's own `Invoice`/`Payment` history (never cross-building). Runs in `scheduler` weekly, writes `KpiSnapshot` + `AlertRule` (`COLLECTION_RATE`, `ARREARS_WOW` already in `kpi/*`).
- *Acceptance:* `GET /api/kpi/forecast?buildingId=` returns `riskUnits: [{label, prob}]` with calibration; second run deterministic.

### P1 — Core UX (month 2–4)

**4. Greek Assembly Minutes (`πρακτικό`) Auto-draft — `assembly/praktiko`**
- *Problem:* `AgendaItem` + `Attendance` + `Ballot` → `quorum` → `πρακτικό` minutes are hand-typed.
- *Local design:* `GET /api/assembly/:voteId/praktiko/draft` → local LLM drafts formal Greek minutes from structured facts (agenda titles, attendance `present/proxy`, `tallyVote` result, `MILLIMES_MAJORITY` vs `HEADCOUNT`). Template: `Σελίδα πρακτικού` with `BuildingBranding` header. Admin edits before publish. Never invents attendees.
- *Greek law text:* Includes `Ν.1221/1981` quorum wording; `Βιβλίο πρακτικών` format.

**5. Defect Report Triage & RFP Auto-create (Greek free text)**
- *Problem:* Residents write `τρέχει νερό στο υπόγειο, μυρίζει` — admin manually classifies `Υδραυλικά` vs `Ηλεκτρολογικά`.
- *Local design:* `POST /api/jobs/classify` (resident `defect` → `trade` + `urgency` + `suggestedCategory`) via local LLM classifier (few-shot Greek examples). If `urgency=high` + `trade` in `ProviderProfile.trade`, auto-suggests `Job.source=RESIDENT_REPORT` → `convert` to `ADMIN_RFP` like `jobs` flow.
- *Acceptance:* Greek description `έσπασε ο θερμοσίφωνας` → `HEAT` + `priority high` + suggested `ExpenseCategory=Θέρμανση`.

**6. Natural Language Search & “Koinoxrista Explain”**
- *Problem:* Residents ask `γιατί πλήρωσα 87,32€` — answer needs share math.
- *Local design:* `GET /api/invoices/:id/explain?locale=el` returns LLM-generated Greek explanation that walks `splitByLargestRemainder` weights (`resolveAllocationWeights`) without re-computing amounts (amounts from `Share` rows, LLM only verbalizes). Example: `Καθαριότητα: 120‰ → 12,00€ (120/1000 × 100€)`. Guarded: amounts never LLM-generated.

**7. Email/SMS Drafting in Greek Formal Register**
- *Problem:* Admins send low-response reminders.
- *Local design:* `POST /api/reminders/draft` → local LLM drafts `Υπενθύμιση οφειλής` in formal Greek (`Παρακαλούμε...`), `≤160-char` SMS variant (`sms` templates already Greek, `reminders/templates`). Admin approves before `reminders/run` sends via Resend/SMS driver.

### P2 — Growth & Compliance (month 4–6)

**8. myDATA/myAADE Greek Error Translator**
- *Problem:* AADE returns `ΑΑΔΕ` XML errors in Greek codes; admins don't understand.
- *Local design:* Local LLM maps `myData.responseRaw` error codes to human Greek fix steps, still offline (`MYDATA_MODE=offline` fallback). No MARK leaves host.

**9. Voice Note → Defect (Greek ASR, local)**
- *Problem:* Older residents prefer voice.
- *Local design:* `whisper.cpp` small `base` Greek model on host → transcript → same triage as #5. Audio deleted after transcript (GDPR).

**10. Building Health NL→SQL Copilot (admin, SELECT-only, audited)**
- *Problem:* `Ποιοι δεν πλήρωσαν 2 μήνες;` needs SQL.
- *Local design:* Local LLM translates Greek NL → parameterized `SELECT` on building-scoped views (`invoices`, `arrears` buckets), rate-limited `10/day/user`, `audit.record` with `questionLength`, result rendered as table + `formatMoney(cents, currency, locale)` (`apps/web/src/app/ui/money.pipe.ts`). Never `INSERT/UPDATE`.

---

## 3. Architecture (local-first)

```
[ Angular `money.pipe` / `i18n es/el` ] ──
                                           ├─▶ NestJS `assistant` guard (buildingId scope)
[ Postgres pgvector | Building data ] ─────┼─▶ `llm-provider` router
                                           │      ├─ ollama (Meltemi 7B)  ──┐
                                           │      └─ openai/anthropic (fallback, AI_LOCAL_ONLY=false)
                                           └─▶ `audit` hash chain + `kpi` snapshots
```

- **Tenant isolation:** every vector row carries `buildingId`; `retrieve()` adds `WHERE buildingId = $1`. E2e asserts cross-building 403.
- **PII redaction:** before LLM: `user{email,phone} → unitLabel` map in `assistant.service.ts:retrieve()`.
- **Fallback:** token budget exceeded or Ollama down → `console` mock → FAQ links (already in `llm-provider.ts` `catch`).
- **Observability:** `Sentry` for `LlmProvider` errors, `JobRun` ledger for `kpi/forecast` and `assembly/praktiko` drafts.

---

## 4. Greek Data & Compliance

- **Sources to embed per building:** `Announcement` (pinned first), `ComplianceItem` (`Ν.4756/2020`), `ExpenseCategory` strategy notes (`Θέρμανση ανά καλοριφέρ`, `Ανελκυστήρας ανά όροφο`), static `assets/legal/n1221_1981.el.md`.
- **GDPR:** Embeddings are derived data; deletion via `POST /api/gdpr/delete-me` anonymizes vectors for that `userId`. Vectors live in EU Postgres, covered by existing `gdpr` module and `docs/RUNBOOK.md` RPO≤24h.
- **Evaluation harness (Greek):** 50-question golden set per building type (12-unit sample `seed.ts`): `χιλιοστά` math, ` myDATA` timeline, `εκοινο` deadlines. CI runs `pnpm nx test api --testPathPattern=assistant` with Meltemi vs Llama switch.

---

## 5. Rollout Phases (2 devs, 6 months)

| Phase | Weeks | Scope | Exit criteria |
|---|---|---|---|
| **A: Local foundation** | 1–4 | Ollama + Meltemi 7B on staging VPS, `pgvector` migration, `assistant` RAG top-k=5 with Greek FAQ, `AI_LOCAL_ONLY` flag | `POST /assistant/query` `buildingId`-scoped, Greek answers cite sources, `pnpm nx test api` green, no hosted calls when `AI_LOCAL_ONLY=true` |
| **B: Greek document triage** | 5–10 | Supplier OCR (Tesseract `ell`), defect triage classifier, `explainInvoice` NL | Photo → `issuerAfm` parse 90% on 20 Greek samples; defect `Υδραυλικά` classifier F1>0.85 |
| **C: Ops copilot** | 11–18 | `πρακτικό` draft, arrears forecast (tabular), NL→SQL SELECT-only + audit, Greek SMS drafting | Admin creates minutes from a closed vote in 1 click; forecast API returns `riskUnits` sorted; NL→SQL audited, 10/day limit enforced |
| **D: Voice + hardening** | 19–24 | `whisper.cpp` Greek, myDATA error translator, token budget + `kpi` alert wiring, load test 20 concurrent queries on 8GB box | P95 < 2s for RAG query on CPX31; budget fallback tested; `sentry` dashboards for `assistant.*` |

---

## 6. Hardware & Cost (Greek SMB reality)

- **Minimum for Meltemi 7B Q4:** 8GB RAM, 4 vCPU, 30GB SSD → Hetzner CPX31 €19/mo or local mini-PC. `bge-m3` embeddings ~1GB. `whisper.cpp` small ~0.5GB.
- **GPU optional:** A4000 for Qwen2-VL 2B vision; else CPU-only (≈3s/query acceptable for building SaaS).
- **Cost control:** `AI_TOKEN_BUDGET_PER_BUILDING=50000` (~€2 at hosted fallback) else local = fixed infra. Annual building fee `€1.50-3.00/unit/mo` (`subscriptions/pricing.ts`) covers it after 4 units.

---

## 7. Risks & Mitigations

- **Greek dialect / polytonic:** Meltemi handles demotic; add few-shot for `katharevousa` in minutes. | Fallback to `llama3.1` with Greek prompt.
- **Hallucination on money:** LLM never computes `amountCents`; `money.pipe.ts` renders from DB. Explanation template is constrained.
- **Model size on small VPS:** Quantize `Q4_K_M` via Ollama; if OOM, auto-fallback to hosted with explicit consent banner `Τα δεδομένα σας θα σταλούν εκτός ΕΕ` (GDPR Art.49).
- **Legal advice liability:** Add disclaimer `Αυτό δεν αποτελεί νομική συμβουλή` on `πρακτικό` drafts; minutes require admin publish.

---

## 8. Verification Checklist (per feature)

- [ ] `buildingId` tenant filter on every new query; e2e `otherBuildingId → 404`.
- [ ] PII redaction before LLM; `audit` row with `hash` chain (`_hash/_prev` in `metadata`) verifies (`GET /audit/verify`).
- [ ] Greek golden-set 50 Q&A green; no English leak when `locale=el`.
- [ ] Offline: Ollama down → graceful FAQ fallback, no 500.
- [ ] `AI_LOCAL_ONLY=true` integration test: `OPENAI_API_KEY` set but not called (spy on `fetch`).

---

## 9. Immediate Next Steps (this sprint)

> Updated 2026-08-31 after codebase audit — see §0b for what's already built vs missing.

1. **Enforce `AI_TOKEN_BUDGET_PER_BUILDING`** — env var exists but nothing reads it. Add a monthly per-building counter (Prisma model or in-memory + DB), check before each LLM call, degrade to FAQ links on breach. Tests: budget exceeded → FAQ fallback, budget reset.
2. **pgvector migration + embedding pipeline** — zero pgvector code exists. Add `CREATE EXTENSION vector`, an `EmbeddingChunk` model (buildingId + chunk text + vector column), BGE-M3 embedder via Ollama `/api/embed`, and swap `assistant.service.ts` keyword scoring for cosine retrieval behind a feature flag. Tenant filter: every vector row carries `buildingId`, `retrieve()` adds `WHERE buildingId = $1`.
3. **Upgrade OCR stub → Tesseract `ell`** — replace `supplier-invoices/ocr.service.ts` stub body with Tesseract `ell` + layout (keep the stub as test mock). Existing confirm/match flow and field parsing (`issuerAfm`, `netCents`, VAT buckets) stay unchanged.
4. **πρακτικό publish flow** — praktiko draft + disclaimer exist (`praktiko-draft.spec.ts`); add admin publish endpoint persisting minutes to the announcement/vote record, audited.
5. **Arrears forecast scheduler wiring** — `forecastArrears()` exists and is tested; wire it into the weekly scheduler to write `AlertRule` (`ARREARS_WOW`) and surface `riskUnits` via the KPI endpoint.
6. Pull `meltemi:7b` + `bge-m3` on staging; set `LLM_PROVIDER=openai-compatible`, `AI_LOCAL_ONLY=true`; run the golden-set (§8 checklist).

References: `apps/api/src/assistant/assistant.service.ts:1`, `apps/api/src/assistant/llm-provider.ts:1`, `apps/api/src/assistant/defect-classifier.ts:1`, `apps/api/src/supplier-invoices/ocr.service.ts:1`, `apps/api/src/assembly/praktiko-draft.spec.ts:1`, `apps/api/src/kpi/kpi.service.ts:257`, `.env.example:96-118`, `apps/web/src/app/ui/money.pipe.ts:1`, `docs/FEATURE_PLAN.md:17`, `docs/INTERNATIONAL_PLAN.md`, `apps/api/prisma/schema.prisma:106-108` (`Building.market/currency`), `apps/api/src/audit/audit.service.ts` (hash chain).
