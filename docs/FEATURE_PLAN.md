# PolykatoikiaOS — Next 20 Features: Detailed Implementation Plan

> Baseline: Phases 0–34 implemented (see `docs/PLAN.md`). This document defines the next 20
> highest-value features, each with problem statement, backend/frontend changes, data model,
> API surface, invariants, and acceptance criteria.
>
> Priority bands: **P0 = correctness/revenue/legal risk** (ship first), **P1 = core UX gaps**,
> **P2 = growth & operations**.

---

## Priority overview

| # | Feature | Priority | Tier gate | Effort |
|---|---------|----------|-----------|--------|
| 1 | Scheduled billing jobs (crons) | P0 | all | M |
| 2 | Live payment gateway (Stripe JP / GMO) | P0 | all | L |
| 3 | Resident self-service registrations | P0 | all | M |
| 4 | Vote auto-close + auto-tally | P0 | all | S |
| 5 | Invoice PDF (日本語対応) | P0 | all | M |
| 6 | Admin role separation & audit scope | P0 | all | M |
| 7 | Security pages (password/2FA/email) | P0 | all | M |
| 8 | Automated backup & DR runbook | P0 | — | M |
| 9 | Mass-mail marketing module | P1 | Pro+ | L |
| 10 | Points/rewards program | P1 | Pro+ | M |
| 11 | Multi-language UI (ja/en/zh/pt) | P1 | all | M |
| 12 | Rate limiting & WAF tuning | P1 | — | S |
| 13 | Inventory & product catalog (shop) | P1 | Pro+ | L |
| 14 | Admin role & granular permissions | P1 | Pro+ | L |
| 15 | Facility inspection & asset lifecycle | P1 | Pro+ | M |
| 16 | Resident mobile app (React Native) | P2 | — | XL |
| 17 | AI assistant (FAQ + ops copilot) | P2 | Premium | L |
| 18 | Public REST API v2 + webhooks | P2 | Premium | M |
| 19 | E-invoice (適格請求書) compliance | P2 | Premium | M |
| 20 | KPI dashboards & anomaly alerts | P2 | Premium | M |

---

## P0 — Correctness / Revenue / Legal Risk

### Feature 1 — Scheduled billing jobs (crons)

**Problem.** Every billing action is manual: invoice run, recurring-expense generation, late-fee
runs, reminders, maintenance `generateDueJobs`, compliance `check-expiries`, vote close/tally.
If an admin forgets, residents are never billed and ρόπα never accrue. A SaaS cannot rely on
manual triggers for money movement.

**Design.** Use `@nestjs/schedule` (already on NestJS 11, minimal deps).

- `apps/api/src/scheduler/scheduler.module.ts` (new), registered in `AppModule`.
- `SchedulerService` with cron jobs (per-building loop, tenant-aware):
  - `0 6 1 * *` — invoice run for previous month (reuses `run-invoices.ts` `aggregateRun`,
    idempotent per `(unitId, periodYearMonth)`).
  - `0 7 1 * *` — recurring-expense generation (`recurring` module, `lastPeriod` guard).
  - `0 8 1 * *` — late-fee run (ρόπα, `LateFeeCharge` `@@unique([unitId, month])` guard).
  - `0 9 * * *` — reminders (arrears buckets, Resend/SMS/console drivers).
  - `30 9 * * *` — maintenance `generateDueJobs` (30-day window, `autoCreateJob=true`).
  - `0 10 * * *` — compliance `check-expiries` (7-day unread de-dup notification).
  - `*/10 * * * *` — vote auto-close/tally (see Feature 4).
- Idempotency: each job tracks `buildingId + period + jobType` in a `JobRun` table
  (unique constraint) — reruns are no-ops. Concurrency guard: `SELECT ... FOR UPDATE SKIP LOCKED`
  or advisory lock per building to avoid double-runs across replicas.
- `JOB_SCHEDULER_ENABLED=true` env gate so only one replica runs jobs.
- Admin UI: `/admin/scheduler` — last run, status, next run, manual trigger button (audited).

**Schema.**
```prisma
model JobRun {
  id         String   @id @default(cuid())
  buildingId String?
  jobType    String   // invoice_run | recurring_gen | late_fee | reminders | maintenance_jobs | compliance_check | vote_close
  period     String?
  status     String   // RUNNING | SUCCESS | FAILED
  message    String?
  startedAt  DateTime @default(now())
  finishedAt DateTime?
  @@unique([buildingId, jobType, period])
  @@index([status, startedAt])
}
```

**Acceptance criteria.**
- Cron fires invoice run on the 1st; rerunning the same period creates zero new invoices.
- Late-fee rerun idempotent (`@@unique([unitId, month])` already guarantees).
- Vote closes and tallies automatically within 10 minutes of `closesAt`.
- Manual trigger from UI is audited; failures visible in `/admin/scheduler` and Sentry.

---

### Feature 2 — Live payment gateway (Stripe JP / GMO Payment Gateway)

**Problem.** Viva Wallet is EU-centric; for a JP-market SaaS, card payments via Viva have high
friction (JP merchants need domestic PSP). No PSP = no revenue.

**Design.** Extend the existing `PspAdapter` abstraction (Viva adapter exists).

- New adapter `apps/api/src/payments/psp-adapters/stripejp.adapter.ts` implementing the same
  interface: `createOrder(invoice, successUrl, cancelUrl)` → `{ orderCode, checkoutUrl }`,
  `verifyWebhook(headers, body)` → event.
- PSP selection per building: `Building.pspProvider` (`viva | stripejp | gmo`), default `viva`.
- Webhook: `POST /api/payments/webhook/:provider` — signature verification
  (`stripe.webhooks.constructEvent`), idempotent by event id, settles `Payment` +
  `Invoice.paidCents` using the same transition logic as Viva webhook.
- IRIS-equivalent for JP: Konbini + bank transfer (Stripe), or credit card only for v1.
- Admin UI: `/admin/psp-settings` — choose provider, enter restricted keys (server-side only).

**Schema.**
```prisma
model Building {
  // add:
  pspProvider String @default("viva")
}
```

**Acceptance criteria.**
- Sandbox: create order → hosted checkout → webhook settles invoice (paidCents updated).
- Replay of webhook is idempotent (event id unique).
- Viva path unchanged (regression: existing e2e passes).

---

### Feature 3 — Resident self-service registration (open join flow)

**Problem.** Residents can only join via admin invite today. Small buildings without an active
admin cannot onboard; this blocks growth. Also, existing invite flow has no email verification.

**Design.** Add a second registration path with email verification.

- `POST /api/auth/register-open` — email + password + building code (8-char, per-building,
  generated when building is created; admin can regenerate from `/admin/settings`).
  - Creates user in `PENDING_VERIFICATION` state (add `User.status`).
  - Sends verification link `?verify=<token>` (sha256-hashed `EmailVerification` row).
- `POST /api/auth/verify-email` — token → activate user, create `Ownership`/`Membership`
  binding only if the email matches an existing `Ownership.email` (owner-of-record list) —
  otherwise lands in "unverified resident" state pending admin approval
  (`Ownership.occupantType=PENDING`).
- Admin UI `/admin/residents` — approve/reject pending residents (audited).
- Rate limit: 5/hour/IP on register-open (existing Throttler).

**Schema.**
```prisma
model Building {
  // add:
  joinCode String @default("") // 8-char; unique per building
}
model EmailVerification {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  consumedAt DateTime?
  createdAt DateTime  @default(now())
  @@index([userId])
}
// User: add status String @default("ACTIVE")
```

**Acceptance criteria.**
- Register with valid building code → verification email → activate → sees own unit balance.
- Email not in ownership list → admin approval required (admin sees pending list).
- Register without code → 400. Wrong code → 400. Reuse of consumed token → 410.

---

### Feature 4 — Vote auto-close + auto-tally

**Problem.** Votes with `closesAt` in the past remain open until an admin manually closes them
(`tallyVote` is manual). Residents keep voting in closed windows; results are stale.

**Design.**
- Part of Feature 1 scheduler (`*/10 * * * *`), but listed separately because it has its own
  domain logic:
  - Find `Vote` where `closesAt < now` and `result IS NULL`.
  - Call existing `tallyVote` (immutable tally, one `Ballot` per unit).
  - Publish `vote.closed` realtime event + notifications to admins (existing flow).
- Idempotent: `result IS NULL` guard + `JobRun` unique row per `(voteId, 'vote_close')`.
- Backfill: one-time script to close/tally all overdue votes.

**Acceptance criteria.**
- A vote past `closesAt` is closed+tallied within 10 min without admin action.
- Manual close still works; race between manual and cron → unique `JobRun` prevents double.
- Ballot after close → 400 (existing behavior preserved).

---

### Feature 5 — Invoice PDF (日本語対応)

**Problem.** Current exports are CSV ledger + HTML receipt. Residents and accountants need a
real PDF 請求書 with JP fonts; print CSS is fragile across browsers.

**Design.** Server-side PDF generation with CJK font support.

- Library choice: `@react-pdf/renderer` is React-only; for NestJS, use **pdfkit** (has JP font
  support via TTF) or headless-Chrome print (heavy). Recommend **pdfkit + NotoSansJP** (OFL).
- `apps/api/src/pdf/` module:
  - `GET /api/invoices/:id/pdf` (role-gated: admin any, resident own unit) — 請求書 layout:
    building branding (logo, colors from `BuildingBranding`), 請求書 header, unit label,
    period, line items from `Share` aggregation, subtotal/tax/total, payment status stamp
    (未払/支払済), footer text.
  - `GET /api/statements/:unitId/pdf` — 年間 statement PDF (reuse statement JSON service).
- Font: bundle `NotoSansJP` subset (~2MB) in `apps/api/assets/fonts/`; register in pdfkit.
- Cache: regenerate on demand; ETag by `(invoiceId, updatedAt)`.

**Acceptance criteria.**
- PDF opens with correct JP glyphs (no tofu), branding applied, totals match invoice.
- Resident can only fetch own unit's PDF (403 otherwise).
- 12-unit building, 20-line invoice renders < 1s.

---

### Feature 6 — Admin role separation & audit scope

**Problem.** Single `ADMIN` role can do everything: billing, members, compliance, legal, and
platform billing. In a real 管理組合, the 会长/理事/监事 split matters; also platform operators
need a distinct role that cannot touch building financial data.

**Design.** Extend RBAC minimally:
- Add `Role.PLATFORM_ADMIN` (platform operator): manages subscriptions, platform invoices,
  referrals, partner leads — but has **no** per-building financial data access.
- Add `Role.BUILDING_OWNER` (理事長): full building admin; `ADMIN` becomes 理事/manager with
  everything except: subscription tier change, platform billing, admin management, transfer
  export/import, legal escalation.
- Migration: existing `ADMIN` users → `BUILDING_OWNER`.
- Guards: `RolesGuard` checks new roles; all existing `[Authorize(Roles="ADMIN")]` annotations
  reviewed and split.
- Audit: platform-admin actions recorded with `actorRole=PLATFORM_ADMIN`.

**Schema.** `enum Role { ADMIN RESIDENT PROVIDER ACCOUNTANT PLATFORM_ADMIN BUILDING_OWNER }`
(Prisma enum extension; migration maps existing ADMIN → BUILDING_OWNER).

**Acceptance criteria.**
- BUILDING_OWNER can do everything ADMIN does today except platform billing.
- PLATFORM_ADMIN sees platform billing/referrals/partners, zero building financial data.
- All existing e2e pass after role migration.

---

### Feature 7 — Security pages (password change / 2FA management / email change)

**Problem.** Users cannot change password or email. 2FA exists (TOTP + recovery codes) but there
is no user-facing management UI (`/settings/security` exists but password/email flows missing).
This is table stakes and blocks enterprise deals.

**Design.**
- API: `POST /api/auth/change-password` (current password re-check, bcrypt rehash, revoke all
  `RefreshSession` except current), `POST /api/auth/change-email` (password re-check + email
  verification token to new address), `GET /api/auth/sessions` + `DELETE /api/auth/sessions/:id`
  (device list/revoke — backend exists in `sessions` module, needs UI wiring).
- UI: extend `/settings/security` — password change form, email change (pending verification
  banner), device/session list with revoke buttons, 2FA enable/disable (exists).
- Audited: all three actions to `AuditLog`.

**Acceptance criteria.**
- Password change → old sessions revoked, current session kept; login with new password works.
- Email change requires verification at new address; old email gets notice.
- Device list shows current device; revoke-others works.

---

### Feature 8 — Automated backups & DR runbook

**Problem.** Single Postgres, no documented backup/restore. Data loss = contractual liability
for a billing SaaS.

**Design.**
- Postgres: `pg_dump` nightly via GitHub Actions (scheduled) or managed provider PITR
  (Neon/SUPABASE daily snapshots + PITR).
- S3-compatible bucket, 30-day retention, SSE-S3 encryption, versioning on.
- Restore drill: documented runbook `docs/RUNBOOK.md` — restore to scratch DB, run migrations,
  boot API against it, smoke test (login + invoice list).
- App-level: `transfer` module already exports per-building JSON (Phase 18) — add scheduled
  monthly export to storage for all active buildings (defense in depth).

**Acceptance criteria.**
- Nightly backup job green for 7 consecutive days; restore drill executed once, documented.
- RPO ≤ 24h, RTO ≤ 2h documented in runbook.

---

## P1 — Core UX gaps

### Feature 9 — Mass-mail marketing module

**Problem.** Admins can only send transactional reminders. For retention and operations
(お知らせ, event notices, 補修のお知らせ), a targeted email broadcast with open tracking is the
top-requested admin capability.

**Design.**
- `Campaign` model: subject, body (text + simple HTML sanitize), audience
  (`ALL | RESIDENTS | ARREARS | CUSTOM(list)`), status `DRAFT | SCHEDULED | SENDING | SENT`,
  scheduledAt, stats (sent/failed/opened).
- `POST /api/buildings/:id/campaigns` (admin, audited), `POST :id/send` (or scheduled via
  Feature 1 scheduler), `GET /api/campaigns/:id/stats`.
- Sending: Resend batch API; 50/batch, 2s between batches; failures logged per-recipient.
- Open tracking: 1×1 pixel `/api/campaigns/:id/open.gif?uid=<recipientId>` (opt-out via
  `Campaign.trackOpens` flag).
- UI: `/admin/campaigns` — compose, preview (merge tags `{{firstName}}` `{{unitLabel}}`),
  test-send to self, send/schedule, stats view.

**Schema.**
```prisma
model Campaign {
  id          String   @id @default(cuid())
  buildingId  String
  subject     String
  body        String
  audience    String   @default("ALL")
  status      String   @default("DRAFT")
  scheduledAt DateTime?
  sentAt      DateTime?
  sentCount   Int      @default(0)
  failCount   Int      @default(0)
  trackOpens  Boolean  @default(true)
  createdById String
  createdAt   DateTime @default(now())
  recipients  CampaignRecipient[]
  @@index([buildingId, status])
}
model CampaignRecipient {
  id         String    @id @default(cuid())
  campaignId String
  userId     String
  email      String
  status     String    // QUEUED | SENT | FAILED | OPENED
  sentAt     DateTime?
  openedAt   DateTime?
  error      String?
  @@unique([campaignId, userId])
}
```

**Acceptance criteria.**
- Send to 12-unit seed building → all recipients get email (console driver in dev).
- Re-send same campaign → 409. Failure of one recipient doesn't stop the batch.
- Open tracking increments once per recipient (first open only).

---

### Feature 10 — Points / rewards program (来店ポイント)

**Problem.** No retention mechanism for residents who pay early/on-time. Points drive on-time
payment and engagement; also a base for future community features.

**Design.**
- `PointTransaction` per user: `+` earn (on-time payment +50pt, event attendance +10pt,
  announcement Q&A +5pt/day cap), `−` redeem.
- Balance = Σ transactions (materialized in `User.pointBalance` for cheap reads, updated in
  the same transaction as the transaction insert).
- Earn triggers: webhook settlement (Feature 2), bank-import apply, treasury IN entry.
- Redeem: `POST /api/points/redeem` → discount on next invoice (line item `ポイント利用`,
  negative line) — capped at invoice total.
- UI: resident `/points` — balance, history; admin `/admin/points` — manual adjust (audited),
  per-building earn rules in `/admin/settings`.
- Tier gate: Pro+.

**Schema.**
```prisma
model PointTransaction {
  id         String   @id @default(cuid())
  buildingId String
  userId     String
  delta      Int      // +earn / -redeem
  reason     String   // ONTIME_PAYMENT | ATTENDANCE | MANUAL_ADJ | REDEEM
  refType    String?  // invoice | ballot | campaign
  refId      String?
  balanceAfter Int
  createdAt  DateTime @default(now())
  @@unique([userId, reason, refId])
  @@index([userId, createdAt])
}
// User: add pointBalance Int @default(0)
```

**Acceptance criteria.**
- On-time payment (webhook settle before period-end) → +50pt, once per invoice (`@@unique`).
- Redeem creates negative line on next invoice run; Σ never negative.
- Manual admin adjust audited.

---

### Feature 11 — Multi-language UI (ja/en/zh/pt-BR)

**Problem.** UI strings are hardcoded Japanese; blocks overseas residents (Brasil-nummers) and
foreign owners. i18n also forces good string hygiene.

**Design.**
- Angular built-in i18n is per-build (4 builds); instead use **ngx-translate** (runtime
  switching, single build) with JSON dictionaries `apps/web/src/assets/i18n/{ja,en,zh,pt}.json`.
- `TranslateModule.forRoot(...)` + `TranslateService` in `APP_INITIALIZER`; language from
  `localStorage` → `Accept-Language` → default `ja`.
- Extract strings from the 53 page components; start with high-traffic pages: layout, login,
  register, balance, votes, feed, admin overview/run/arrears.
- Backend: error messages stay Japanese v1; add `Accept-Language`-aware validation messages in
  `libs/shared` DTO error maps later.
- Language switcher in layout header (persisted per user profile: `User.locale`).

**Acceptance criteria.**
- ja/en complete for layout+auth+balance+votes; zh/pt for layout+auth (phase-in).
- Language persists across sessions; no layout breakage with longer en strings (spot-check).

---

### Feature 12 — Rate limiting & WAF tuning

**Problem.** Global throttler exists (10/min on auth) but mutation endpoints (login, register,
checkout, webhook) need per-route budgets; also brute-force lockout is missing.

**Design.**
- Extend `ThrottlerModule` config: per-route `@Throttle()` decorators —
  login 5/15min/IP, register 3/hour/IP, checkout 10/min/user, webhook 100/min (allow-list by
  PSP IP), public API stays 60/min/key.
- Login lockout: after 5 failed logins in 15 min per (email, IP) → 423 with retry-after;
  counter in Redis or in-memory (single-node OK now) + audited.
- Security headers review: helmet config — CSP for the SPA origin, HSTS in prod,
  `X-Content-Type-Options`, `Referrer-Policy`.
- Add `GET /api/health` detail (db ping, psp reachability) with degraded state (exists in
  Phase 34 — verify coverage).

**Acceptance criteria.**
- 6th login attempt within 15 min → 423; success resets counter; audit row per lockout.
- Swagger still reachable non-prod; CSP doesn't break SPA (test in staging).

---

### Feature 13 — Inventory & product catalog (共益費販売/イベントチケット)

**Problem.** Buildings sell physical goods (イベント参加, 備品, 駐輪場) outside the monthly
billing cycle. Today there's no way to charge for one-off items.

**Design.**
- `Product` (name, priceCents, stock, image, active, tier-gated), `ProductOrder`
  (unit, qty, amount, status `PENDING | PAID | CANCELLED`, payment via Feature 2 checkout or
  added to next invoice run as a line item).
- Admin `/admin/shop` CRUD; resident `/shop` browse + order; order flows into either
  (a) immediate checkout (PSP) or (b) next invoice line.
- Stock decrement at order create (optimistic; negative-stock 409).
- Tier gate: Pro+.

**Schema.**
```prisma
model Product {
  id          String  @id @default(cuid())
  buildingId  String
  name        String
  priceCents  Int
  stock       Int     @default(0)
  imageKey    String?
  active      Boolean @default(true)
  @@index([buildingId, active])
}
model ProductOrder {
  id         String   @id @default(cuid())
  buildingId String
  unitId     String
  productId  String
  qty        Int
  amountCents Int
  status     String   @default("PENDING") // PENDING | PAID | CANCELLED
  paymentRef String?
  createdAt  DateTime @default(now())
  @@index([buildingId, status])
}
```

**Acceptance criteria.**
- Order with stock 0 → 409; paid order decrements stock once (webhook idempotent).
- Add-to-invoice option appears in next invoice run as line item.

---

### Feature 14 — Admin role & granular permissions

**Problem.** Within a 管理組合, different admins have different duties (会計 vs 庶務 vs 理事長).
Feature 6 adds roles; this adds per-admin permission toggles.

**Design.**
- `AdminPermission` join table: `adminUserId + buildingId + permissionKey` (allow-list keys:
  `billing.manage`, `members.manage`, `compliance.manage`, `legal.manage`, `votes.manage`,
  `documents.manage`, `treasury.manage`, `reports.view`, `settings.manage`).
- `RolesGuard` + new `PermissionsGuard`: mutation endpoints annotated with required permission;
  BUILDING_OWNER implicitly has all.
- Admin UI `/admin/admins` (BUILDING_OWNER only) — checkbox matrix per admin.
- Audited grant/revoke.

**Schema.**
```prisma
model AdminPermission {
  id             String   @id @default(cuid())
  userId         String
  buildingId     String
  permissionKey  String
  grantedById    String
  createdAt      DateTime @default(now())
  @@unique([userId, buildingId, permissionKey])
}
```

**Acceptance criteria.**
- Admin without `billing.manage` gets 403 on expense create; with it, 200.
- BUILDING_OWNER bypasses checks; matrix changes audited.

---

### Feature 15 — Facility inspection & asset lifecycle

**Problem.** `BuildingAsset` + `MaintenanceSchedule` exist (assets CRUD + schedule + generate
due jobs) but there's no inspection record history, no photo, no cost-per-asset roll-up.

**Design.**
- `InspectionRecord`: asset, date, inspector (provider userId or admin), result
  (`OK | NG | REPAIR_NEEDED`), photo `fileKey` (reuse documents storage), notes.
- Asset detail view: schedule timeline + inspection history + Σ supplier payments for linked
  jobs (cost roll-up via existing `SupplierPayment.jobId`).
- `POST /api/buildings/:id/assets/:assetId/inspections` (admin + provider for job-linked
  assets); auto-create `WorkLog` when inspection done via job.
- Maintenance page upgrade: calendar view of `nextDueAt` (12-month), overdue red.
- 法定点検 (legal inspections) pre-seeded: elevator (半年), fire safety (半年), boiler (年1) —
  seeding script for new buildings.

**Schema.**
```prisma
model InspectionRecord {
  id          String   @id @default(cuid())
  assetId     String
  buildingId  String
  inspectedAt DateTime
  inspectorId String?
  result      String   // OK | NG | REPAIR_NEEDED
  photoKey    String?
  notes       String?
  jobId       String?
  createdAt   DateTime @default(now())
  @@index([assetId, inspectedAt])
}
```

**Acceptance criteria.**
- Inspection with photo appears in asset timeline; NG result suggests creating a job (link).
- Asset cost roll-up matches Σ SupplierPayment for jobs linked to the asset.

---

## P2 — Growth & operations

### Feature 16 — Resident mobile app (React Native / Expo)

**Problem.** Residents are on mobile; PWA exists but push on iOS PWA is limited and discovery
is poor. A dedicated app improves payment rates and read rates of announcements.

**Design.**
- Expo (RN) app consuming the existing REST API + public API v2 (Feature 18).
- Reuse: JWT auth flow (access + refresh), balance/invoice list, payment checkout (in-app
  browser to PSP hosted page), push (Expo notifications → server needs an Expo push adapter
  next to `push-sender.ts`), announcements feed, votes.
- Auth: same accounts; device binding via `RefreshSession` (device management exists).
- Store presence: Apple App Store / Google Play (Apple requires company account; budget time).

**Acceptance criteria.**
- Login → balance → pay (hosted PSP page) → push on invoice issue — end-to-end on both
  platforms.
- Session revoke from web security page kills app session.

---

### Feature 17 — AI assistant (FAQ + ops copilot)

**Problem.** Admins repeatedly answer the same resident questions (支払い方法, 精算, 水道).
An AI assistant with building-specific context (announcements, FAQ, invoices) deflects tickets.

**Design.**
- RAG: embed announcements + FAQ + static help content (pgvector on Postgres 16; `pgvector`
  extension).
- API: `POST /api/assistant/query` (resident+admin), retrieves top-k chunks scoped to
  `buildingId`, LLM generates answer with citations; no cross-building data.
- Ops copilot (admin): "先月の未徴収トップ5は？" → NL→SQL restricted to SELECT on
  building-scoped views, audited, rate-limited 10/day/user.
- LLM provider: env-key (OpenAI/Anthropic); console mock for dev; PII redaction before send
  (names → unit labels).

**Acceptance criteria.**
- Answers cite source announcements; never leak other buildings' data (tenant filter tested).
- Cost control: per-building monthly token budget, exceeded → graceful fallback to FAQ links.

---

### Feature 18 — Public REST API v2 + webhooks

**Problem.** Public API v1 is read-only (3 endpoints). Accountant tools and property management
integrations need richer reads + push webhooks.

**Design.**
- v2 under `/api/public/v2` (same `X-Api-Key` auth, scopes): invoices (list/detail), payments,
  arrears, votes+results, announcements, statements, units/ownerships.
- Cursor pagination, `X-Total-Count`, rate 600/min/key (Premium).
- **Outbound webhooks**: `WebhookEndpoint` per building (url, secret, events[], active);
  events: `invoice.issued`, `invoice.paid`, `vote.closed`, `job.bided`, `arrears.flagged`.
  HMAC-SHA256 signature header `X-Polyk-Signature: t=<ts>,v1=<hmac>`; 3 retries with
  exponential backoff; delivery log viewer in `/admin/webhooks`.
- Tier gate: Premium (v1 stays Premium).

**Schema.**
```prisma
model WebhookEndpoint {
  id         String   @id @default(cuid())
  buildingId String
  url        String
  secret     String   // sha256 stored? no — needs raw to sign; encrypt at rest
  events     String[]
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  @@index([buildingId, active])
}
model WebhookDelivery {
  id        String   @id @default(cuid())
  endpointId String
  event     String
  payload   Json
  status    String   // PENDING | SUCCESS | FAILED
  attempts  Int      @default(0)
  lastStatus Int?
  response  String?
  nextRetryAt DateTime?
  createdAt DateTime @default(now())
  @@index([endpointId, status, nextRetryAt])
}
```

**Acceptance criteria.**
- Signature verified by test receiver; replay with bad signature → 401 on receiver side.
- Retry schedule 1m/5m/25m; dead-letter after 3; delivery log visible.

---

### Feature 19 — E-invoice (適格請求書) compliance fields

**Problem.** Japan's インボイス制度 requires 適格請求書 fields (登録番号 T+13digits, 税率×税額
breakdown per rate). myDATA module is GR-specific; JP market needs its own compliance.

**Design.**
- Extend invoice/statement PDF (Feature 5): 登録番号 field per building (admin settings),
  税率別内訳 (8%/10% lines with tax amounts), 適格請求書 header.
- `Building.invoiceRegistrationNo` (T-number, validated `^T[0-9]{13}$`).
- Tax handling: add optional `taxRateBps` on `ExpenseCategory` (default 10% 適用); invoice
  aggregation computes per-rate subtotals.
- Statement/宛名 PDF gets 登録番号 + per-rate tax rows.

**Schema.**
```prisma
model Building {
  // add:
  invoiceRegistrationNo String?
}
model ExpenseCategory {
  // add:
  taxRateBps Int @default(1000) // 10%
}
```

**Acceptance criteria.**
- PDF shows T-number + per-rate breakdown; Σ tax = Σ (line × rate) rounding per line
  (四捨五入, documented).
- Buildings without T-number print 適格請求書の登録番号欄 blank (valid until transition end).

---

### Feature 20 — KPI dashboards & anomaly alerts

**Problem.** Analytics dashboard (Phase 12) shows historical aggregates but no alerting.
Admins miss arrears spikes and payment drops until month-end.

**Design.**
- Extend `reports` module with weekly snapshot table `BuildingWeeklySnapshot` (invoiced,
  collected, arrears total, arrears units, collection rate, new defects, open jobs) computed
  by Feature 1 scheduler (Monday 07:00).
- Anomaly rules (per building, threshold-based, no ML): collection rate < 80% for 2 consecutive
  weeks; arrears total +30% WoW; new defects > N in 7d; PSP webhook failure spike.
- Alerts → admin notifications + email digest (Feature 9 campaign infra, audience=ADMINS).
- UI: `/admin/analytics` gains trend arrows + alert banner; `/admin/alerts` rule config.

**Schema.**
```prisma
model BuildingWeeklySnapshot {
  id             String   @id @default(cuid())
  buildingId     String
  weekStart      DateTime
  invoicedCents  Int
  collectedCents Int
  arrearsCents   Int
  arrearsUnits   Int
  collectionRate Float
  openJobs       Int
  newDefects     Int
  createdAt      DateTime @default(now())
  @@unique([buildingId, weekStart])
}
model AlertRule {
  id         String   @id @default(cuid())
  buildingId String
  metric     String   // COLLECTION_RATE | ARREARS_WOW | DEFECTS_7D | PSP_FAILURES
  threshold  Float
  window     String   @default("7d")
  active     Boolean  @default(true)
  lastFiredAt DateTime?
  @@unique([buildingId, metric])
}
```

**Acceptance criteria.**
- Snapshot job fills 8 weeks on first run (backfill), then weekly.
- Seeded anomaly (collection rate drop) fires alert once; de-dup via `lastFiredAt`.

---

## Cross-cutting requirements

- **Every feature:** Prisma migration + seed update (if new tables), `libs/shared` DTOs,
  Jest/Vitest unit tests for domain logic, Playwright e2e for happy path, audit logging on
  mutations, `ROUTES_REGISTRATION.txt` update per module convention.
- **Tenant isolation:** every new query must be `buildingId`-scoped; add to code-review
  checklist; e2e asserts cross-building 403/404.
- **Tier gating:** features 9, 10, 13, 14, 15, 18, 19, 20 behind feature flags per
  `Subscription.tier` (existing flags mechanism).
- **Order of execution (recommended):** 1 → 4 → 7 → 5 → 3 → 2 → 6 → 8 → 12 → 11 → 9 → 10 →
  14 → 15 → 13 → 18 → 19 → 20 → 17 → 16.
- **Estimates:** S ≈ 1–2 days, M ≈ 3–5 days, L ≈ 1–2 weeks, XL ≈ 3–4 weeks (single dev).

## Out of scope (explicitly)

- Native iOS/Android beyond Feature 16 (no separate codebases).
- Multi-currency (JP market = JPY; keep `cents` integer math).
- Chat/messaging between residents (abuse risk; announcements Q&A suffices for v1).
- Automated legal filing integration (legal module stays manual workflow).
