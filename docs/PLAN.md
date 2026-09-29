# PolykatoikiaOS — Implementation Plan

## 0. Confirmed Scope

Single full-stack WEB SaaS (no native mobile; mobile-first responsive). One application, ONE dashboard shell whose navigation/content adapts to the signed-in role. NO separate dashboards per role, NO organizational departments.

Three roles enforced by RBAC:

- **ADMIN** — building manager / committee
- **RESIDENT** — owner / tenant
- **PROVIDER** — technician / supplier

Stack decision locked: **Angular + NestJS + PostgreSQL** (user-requested). Payments via **Viva Wallet** (Phase 1).

## 1. Architecture & Stack

- **Monorepo:** Nx workspace
  - `apps/web` — Angular standalone components, signals, lazy routes, TailwindCSS
  - `apps/api` — NestJS REST API
  - `libs/shared` — DTOs and shared types
- **Database:** PostgreSQL + Prisma ORM (local Docker Compose for dev; managed Neon/Supabase for prod)
- **Auth:** JWT access token + HttpOnly refresh cookie; session carries `{buildingId, userId, role}`
- **Payments:** Viva Wallet REST API (cards + IRIS/DIAS instant transfers) behind a PSP abstraction interface; webhook reconciliation
- **Files:** S3-compatible storage
- **Notifications:** Resend email + Web Push
- **Hosting:** static web hosting for the frontend; Render/Railway for the API; Sentry + PostHog for observability; GitHub Actions CI

## 2. Roles & Permission Matrix (RBAC)

| Capability | ADMIN | RESIDENT | PROVIDER |
| --- | :---: | :---: | :---: |
| Manage buildings/apartments/millismata | Yes | No | No |
| Create expenses, allocate shares, issue monthly koino | Yes | Views own only | No |
| Record/view payments, arrears | Manages | Views/pays own balance | No |
| Open votes/assemblies, set thresholds | Yes | Votes within window | No |
| Post RFPs/maintenance jobs | Posts | Reports defects | Browses/bids |
| Submit bids, quotes, work logs | No | No | Yes |
| Documents | Manages | Reads | Reads job-related only |
| Subscription billing (per-unit tier) | Committee owner only | No | No |

Enforcement: NestJS guards server-side on every mutation; the UI merely hides disallowed actions.

## 3. Domain Data Model

Prisma outline:

```prisma
Building ─ Unit(apartment)
        └─ Ownership(user ↔ unit, millimes‰, period)

Expense(category, allocationStrategy: MILIMES | UNITS | CUSTOM)
  └─ Share(unitId, amount)          // computed at creation

Invoice(month, status)
  └─ Payment(pspRef, method CARD | IRIS, status)

Vote(topic, thresholdType, opensAt, closesAt)
  └─ Ballot(unitId, choice)         // one vote per unit

Job(RFP)
  └─ Bid(providerId, amount, docs)
      └─ WorkLog

Document(type, fileKey)
Subscription(tier, units, status)
User(role, email, phone, iban?)
Provider(trade, certs[], rating)
```

Notes:

- Millismata stored as integers out of 1000 (N.1221/1981).
- Rounding via the largest-remainder method so Σ shares always equals the expense total.
- Multi-tenant: every table keyed by `buildingId`.

## 4. Core Modules

1. **Koinoxrista Engine** — expense categories, allocation strategies (millimes default; elevator-by-floor and heating-by-radiator options per Greek regulation), monthly run → invoices per unit.
2. **Payments** — invoice page with card checkout + IRIS QR/deep-link, PSP webhook reconciliation, arrears aging + automated reminders, CSV/PDF ledger export for accountants.
3. **Governance & Maintenance** — assemblies with agenda items, configurable quorum/thresholds (simple majority / % of millimes), immutable results page; RFP workflow open → bids → awarded → work log → linked expense.

## 5. Compliance

- **GDPR:** consents, DPA with sub-processors, data export/delete, EU hosting.
- **myDATA (ΑΑΔΕ e-invoicing):** deferred to Phase 4 — v1 tracks receipts only.
- **IRIS/DIAS:** accessed via licensed PSP (Viva Wallet).
- **Audit log:** table recording all financial/voting mutations.

## 6. Monetization

| Tier | Price | Includes |
| --- | --- | --- |
| Basic | €1.50/unit/month | Billing + payments + documents |
| Pro | €2.25/unit/month | Basic + voting, defect reports, reminders |
| Premium | €3.00/unit/month | Pro + RFP marketplace priority, accountant exports, API |

Free 60-day trial, minimum 4 units, annual prepay −15%.

## 7. Roadmap

| Phase | Weeks | Scope | Exit criteria |
| --- | --- | --- | --- |
| Phase 0 ✅ | wk 1–2 | Repo scaffold, CI, auth, tenancy skeleton, deploy pipeline | Pipeline green end-to-end |
| Phase 1 MVP ✅ | wk 3–10 | Buildings/units/millismata CRUD → split engine → invoice generation → Viva Wallet card payments → resident balance view | A pilot building runs a real month |
| Phase 2 ✅ | wk 11–16 | Email reminders, arrears dashboard, documents, voting (IRIS QR deferred to P8) | First live assembly vote |
| Phase 3 ✅ | wk 17–22 | Provider onboarding + RFP marketplace, ratings, work logs | Marketplace live with bids & ratings |
| Phase 4 ✅ | 2026-08 | Heating allocation by radiator count, elevator-by-floor strategy, myDATA invoice records + XML export (`MYDATA_MODE=offline`), multi-building admins via `Membership` + building switcher, public REST API with scoped API keys (Premium-gated) | Directory of new modules registered; specs green |
| Phase 5 ✅ | 2026-08 | Subscription tiers Basic/Pro/Premium per §6 (60-day trial, annual −15%, min 4 units), GDPR export + anonymizing erasure, append-only audit log + admin viewer | Financial/voting mutations audited; erasure keeps financial records |
| Phase 6 ✅ | 2026-08 | **Technician directory & defect reports** — `GET /providers` search (trade/city/minRating/q) for ADMIN+RESIDENT, bid-derived ratings, profile enrichment (city/bio/hourly rate), resident defects → admin RFP conversion (`Job.source`) | Residents find & request technicians; providers see only published RFPs |
| Phase 7 ✅ | 2026-08 | **Notifications & PWA** — in-app inbox wired to invoice/vote/bid/work-log events, Web Push (VAPID + console fallback), installable PWA with hand-rolled offline shell | Push sent on invoice issue; app installs & opens offline |
| Phase 8 ✅ | 2026-08 | **Integrations & observability** — live AADE/myDATA adapter (`SendInvoiceDocs`, retry/backoff, reconcile), IRIS QR + deep-link payments, Sentry api+web (DSN-gated), GitHub Actions CI | MARKs from AADE sandbox (needs credentials QA); errors visible in Sentry |
| Phase 9 ✅ | 2026-08 | **Recurring expenses & auto-billing** — `RecurringExpense` templates (amount, MILIMES/UNITS strategy, category), idempotent period generation reusing largest-remainder splits, admin UI page | Generate twice → second run creates nothing; Σ shares = amount |
| Phase 10 ✅ | 2026-08 | **Printable annual statements** — per-unit year statement JSON (admin per-unit + resident `/statements/mine`), print-ready resident sheet (`/balance/statement`) with print CSS, balance-page entry point | Resident prints a clean annual βεβαίωση |
| Phase 11 ✅ | 2026-08 | **Bank CSV import & payment matching** — tolerant GR-bank CSV parser (delimiters, decimal comma, date formats), confidence-scored match suggestions (high/medium/low), apply settles IRIS payments mirroring webhook transition (idempotent, audited) | Admin pastes statement → matched payments settle in one review |
| Phase 12 ✅ | 2026-08 | **Admin analytics dashboard** — `/reports/summary` aggregates (invoiced/collected/arrears by month, expenses by category, collection rate), hand-rolled SVG bar/spark charts, KPI cards, 6–24-month window | Zero-dependency charts render live building data |
| Phase 13 ✅ | 2026-08 | **Security hardening & API docs** — helmet, CORS allow-list env, global ValidationPipe, app-wide Throttler (10/min on auth), secure refresh cookie in prod, Swagger at `/api/docs` (non-prod/env-gated) | Hardened bootstrap; OpenAPI browsable outside prod |
| Phase 14 ✅ | 2026-08 | **Member invites** — admin email invites (RESIDENT bound to a unit, ADMIN to a membership), SHA-256-hashed one-time tokens with configurable expiry & `invite=` deep link merged into `POST /auth/register`, pending-duplicate 409s, re-invite after accept/expiry, list/revoke UI (`/admin/invites`) | Invited user registers via token and lands in the right unit/building |
| Phase 15 ✅ | 2026-08 | **Compliance registry** — insurance policies & certificates (Ν.4756/2020) with premium/policy number/date range, computed `expired`/`daysLeft`, kind & `upcomingDays` filters, `check-expiries` action notifying every admin with 7-day unread de-dup, audited mutations, admin UI (`/admin/compliance`) | Expiring items notify admins once per window; overdue items flagged |
| Phase 16 ✅ | 2026-08 | **Annual budgets** — `BudgetLine` per building/year/category, planned-vs-actual compare endpoint aggregating lines per category (uncategorized roll-up last), CRUD admin UI (`/admin/budgets`) | Compare rows show Σ planned vs Σ actual expenses for the year |
| Phase 17 ✅ | 2026-08 | **Supplier payouts ledger** — BANK/CASH/CHECK/CARD payments linked to jobs/expenses with reference/notes, monthly summary totals, provider self-view `GET /payouts/mine`, audited CRUD, admin UI (`/admin/payouts`) | Payout recorded against a job/expense appears in admin ledger & provider view |
| Phase 18 ✅ | 2026-08 | **Building transfer (backup/restore)** — versioned JSON export of the full building graph (units+millimes/radiators, ownerships by email, categories w/ strategies, recurring templates, budget lines, compliance items) and import that always creates a NEW building, re-linking existing users only, returning created counts + skipped report | Export → import round-trip reproduces a working building |

### Commercial expansion (phases 19–34)

| Phase | Scope | Exit criteria |
| --- | --- | --- |
| Phase 19 ✅ | 2026-08 | **Excel/CSV units import** — xlsx (exceljs) + tolerant CSV upload per existing building, GR/EN header synonyms, dry-run preview with per-row errors & Σ‰ warning, confirm-to-upsert by normalized label, audited | Spreadsheet → validated units in one review screen |
| Phase 20 ✅ | 2026-08 | **Ρόπα late-payment surcharges** — per-building policy (grace days, FLAT cents/day or PERCENT bps of outstanding, cap), idempotent run charging unpaid invoices past period-end+grace (unique unit+month), waive flow, audited | Second run creates zero; partial payments charged on outstanding only |
| Phase 21 ✅ | 2026-08 | **TOTP two-factor auth** — dependency-free RFC-6238 (validated against RFC-4226 vectors), otpauth QR via existing component, stateless HMAC login ticket, ±1 window verification, 10 single-use hashed recovery codes, password-recheck disable, audited | 2FA-enabled logins require second factor; recovery codes consume once |
| Phase 22 ✅ | 2026-08 | **SMS outbound channel** — `SmsSender` abstraction (console default; generic HTTP gateway via env) hooked into invoice-issued/vote-opened/arrears reminders for users with phone, ≤160-char Greek templates, per-process dedupe | Reminders text owners when SMS_MODE=http is configured |
| Phase 23 ✅ | 2026-08 | **Accountant seat** — `ACCOUNTANT` role + per-building grants, read-only summary/statements/payouts/arrears endpoints reusing existing services, year-end απολογισμός aggregation (income/costs by category, monthly series, per-unit closing balances) with printable page | Λογιστής sees assigned buildings read-only; grant/revoke audited |
| Phase 24 ✅ | 2026-08 | **Platform self-billing** — myDATA-style `PlatformInvoice` (SI-year-seq numbering under advisory lock), monthly/tier-delta issuance reusing subscription pricing incl. proration and annual −15%, trial periods auto-PAID, admin billing page | Rerun same period → no duplicate; tier change issues prorated delta |
| Phase 25 ✅ | 2026-08 | **Digital assembly mode** — agenda items w/ ordering, attendance/proxy check-in grid, live ‰ quorum meter vs SIMPLE_MAJORITY/MILLIMES thresholds, auto-generated πρακτικό minutes page (print-ready) | Quorum math counts proxies; closed vote renders decisions in πρακτικό |
| Phase 26 ✅ | 2026-08 | **Open-banking feed reconciliation** — BankConnection/ImportedTransaction models, offline deterministic adapter + GoCardless skeleton (`OPENBANKING_MODE`), sync dedupes on externalId and feeds existing `suggestMatches` engine; settlement stays in bank-import apply | Re-sync imports nothing twice; suggestions annotated high/med/low |
| Phase 27 ✅ | 2026-08 | **Meter readings & METERS allocation** — WATER/HEAT meters per unit, monthly consumption upserts, new AllocationStrategy splitting category expenses by consumption share (largest remainder), hard validation listing units missing readings | Σ shares = expense; missing-readings run fails naming units exactly |
| Phase 28 ✅ | 2026-08 | **Announcements newsfeed** — admin posts/pin/edit/delete with in-app fan-out (ALL\|RESIDENTS), resident feed pinned-first with Q&A comment threads, own-comment delete, audited mutations | Residents discuss under announcements; foreign buildings isolated |
| Phase 29 ✅ | 2026-08 | **Payment plans (τμηματοποίηση)** — split unit arrears into 2–24 installments (remainder to earliest), oldest-first payment allocation w/ partial installment balances, single-active-plan 409, cancel remaining, COMPLETED transition, resident timeline view | Σ installments = total; overpay rejected; completion audited |
| Phase 30 ✅ | 2026-08 | **White-label branding** — logo/colors/org/footer/customDomain per building, hex+https+domain validators, public branding endpoint (guard-free like webhooks), branded print headers on statement & απολογισμός | Print outputs carry building brand; domain conflicts 409 |
| Phase 31 ✅ | 2026-08 | **Marketplace monetization** — JobCommission captured on bid award (bps rate env-tunable, cap, DUE→PAID/WAIVED, yearly summary), FeaturedSlot directory placement w/ overlap 409s and featured-first sort | Awarding a bid books commission; featured providers sort first |
| Phase 32 ✅ | 2026-08 | **Referral program** — unique building codes (?ref= capture at register → activation), REFERRED +3 months / REFERRER +1 month as atomic ReferralCredit rows, whole-month redemption discounting platform invoices (never blocks issuance) | Same code twice grants nothing; credits discount SI-invoices oldest-first |
| Phase 33 ✅ | 2026-08 | **Partner leads pipeline** — insurance/elevator/energy lead tracker with forward-only status machine (WON requires realized amount, LOST terminal), won-commission summaries by category/month, kanban-lite UI | Transition matrix enforced; summaries aggregate won commissions only |
| Phase 34 ✅ | 2026-08 | **Trust & ops polish** — RefreshSession device management (list/revoke/revoke-others, rotation-aware), public `/health` (db ping → degraded), localStorage-gated help tours on role landings, dependency-free PostHog beacon funnel events (env-gated) | Users revoke stale devices; funnels measurable when POSTHOG_KEY set |

Remaining sandbox QA: AADE live credentials (full XSD mapping done: issue metadata, income classifications, invoiceSummary totals, VAT-category codes); Viva IRIS end-to-end in demo PSP.

## 8. Verification Strategy

- **Property tests (Vitest/Jest)** for the split engine: Σ shares = Σ expense; deterministic rounding under the largest-remainder method.
- **E2E (Playwright/Cypress):**
  - Admin creates month → resident pays → webhook marks paid.
  - Vote lifecycle test (open → ballots → close → immutable results).
- **Seed script:** realistic 12-unit Thessaloniki building.
