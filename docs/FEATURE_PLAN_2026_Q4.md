# PolykatoikiaOS — 2026 Q4 Feature Plan: Next 20 Missing Features

> Baseline: Phases 0–34 + original "next 20" (`docs/FEATURE_PLAN.md`), International P0 and
> LangChain/LangGraph Phases 1–2 are **shipped**. This document defines the **next 20**
> verified-missing features. Each section is an executable spec: problem, design, data model,
> API surface, invariants, acceptance criteria.
>
> Priority bands: **P0 = correctness / revenue / legal risk** (ship first), **P1 = core UX gaps**,
> **P2 = growth & operations**.
> Effort: S ≈ 1–2 days, M ≈ 3–5 days, L ≈ 1–2 weeks, XL ≈ 3–4 weeks (single dev).

---

## Priority overview

| # | Feature | Priority | Effort |
|---|---------|----------|--------|
| 1 | Blockchain authentication (SIWE wallet login) | P0 | M |
| 2 | Passkeys / WebAuthn (passwordless + MFA) | P0 | M |
| 3 | Greek gov eID login (gov.gr / TaxisNet / eIDAS) | P0 | M |
| 4 | SEPA Direct Debit mandates + pre-notification | P0 | M |
| 5 | Multi-step dunning & collections automation | P0 | M |
| 6 | On-chain audit & vote anchoring (Merkle roots → L2) | P1 | M |
| 7 | Marketplace escrow + dispute resolution | P1 | L |
| 8 | Enterprise SSO (OIDC + SAML + SCIM) | P1 | L |
| 9 | Soulbound membership tokens & verifiable credentials | P2 | L |
| 10 | Stablecoin payments (USDC on Polygon) | P2 | M |
| 11 | Insurance claims workflow | P1 | M |
| 12 | Resident support desk (tickets / SLA / CSAT) | P1 | M |
| 13 | E-signature & document workflow (eIDAS AdES) | P1 | L |
| 14 | Accounting integrations (QuickBooks / Xero / ERP) | P1 | L |
| 15 | Sealed-bid e-auction (commit-reveal RFPs) | P2 | M |
| 16 | Lease & tenancy lifecycle (rent, deposits) | P1 | L |
| 17 | IoT smart meters & energy ingest + EPBD ESG reporting | P1 | L |
| 18 | LangGraph agent graphs (nl-sql self-correct, defect classify, praktiko revision) | P1 | M |
| 19 | Streaming + multi-turn copilot (SSE conversations) | P2 | M |
| 20 | Mobile native push (FCM/APNs) + offline sync | P1 | L |

Features 1–15 are implemented by the current worktree wave (`feat/01-*` … `feat/15-*`).
Features 16–20 are the follow-up wave.

---

## Cross-cutting requirements (every feature)

- **Tenant isolation** — every new query is `buildingId`-scoped behind `assertSameBuilding()`
  (`apps/api/src/common/tenant.ts`); e2e/unit specs assert cross-building 403/404.
- **Audit** — every mutation writes `AuditService.record({ buildingId, actorId, actorRole,
  action, entity, entityId, metadata })`.
- **Data model** — `apps/api/prisma/fragments/<feature>.prisma` (Prisma models, repo
  convention) **plus** matching `<feature>.sql` (hand-written CREATE TABLE); the integrator
  merges models into `schema.prisma`. Every model carries `buildingId` FK cascade +
  `@@index([buildingId])`.
- **Shared types** — DTOs/validators in `libs/shared/src/lib/<feature>.ts`, re-exported from
  `libs/shared/src/index.ts`.
- **Tests** — adjacent `*.spec.ts` (Jest 30, PrismaService mocked, no DB): happy path,
  validation, idempotency, tenant isolation, money/rounding invariants where money moves.
- **Driver pattern** — follow the repo's adapter convention (like `SmsSender`, `PushSender`,
  Viva adapter): a `console`/`mock` driver by default, real driver behind env config +
  optional dependency, graceful degradation, never 500 on external outage.
- **Env** — append to `.env.example` under a banner comment naming the feature.
- **Blockchain features (1, 6, 9, 10)** — PII never goes on-chain (salted hashes / unit
  refs only); GDPR erasure scrubs off-chain links while anchors remain; defaults keep
  current behavior (`ANCHOR_MODE=off`, wallet login optional, `pspProvider` unchanged).

---

## Feature 1 — Blockchain authentication (SIWE wallet login) ⛓️ P0

**Problem.** Auth is password + TOTP only. Diaspora owners (large Greek-property segment)
and crypto-native users want wallet login; the platform needs a stronger identity anchor.

**Design.** New module `apps/api/src/auth-blockchain/` (deps: `siwe`, `viem`).
- `POST /auth/wallet/nonce` — `{ address, chainId }` → single-use nonce (sha256-hashed,
  5-min TTL) stored in `WalletNonce`; throttled 5/min/IP.
- `POST /auth/wallet/verify` — `{ message, signature }` → parse SIWE (EIP-4361), verify
  domain binding (`WEB_APP_URL`), nonce single-use, expiry, and EIP-191 signature recovery
  → link-or-create `User` → mint the **same** JWT pair as password login (reuse
  `AuthService` token minting; 2FA enforced if enabled on the account).
- `POST /auth/wallet/link` (password-or-TOTP re-check, audited) / `DELETE /auth/wallet/link`
  — attach/detach a wallet to an existing account.
- Wallet-only login grants `RESIDENT` scope until the wallet's user is linked to a
  `Membership`/`Ownership` (no role escalation). ChainId allow-list `1, 137, 8453`
  (`WALLET_CHAIN_IDS`). Addresses stored lowercased, `@@unique([chainId, address])`.
- Resolve ENS/lens name best-effort for display; never required.

**Schema.** `WalletIdentity { id userId address chainId isPrimary verifiedAt createdAt
@@unique([chainId,address]) }`, `WalletNonce { id nonceHash address expiresAt consumedAt }`.

**Acceptance.** Valid signature → JWT pair; replayed signature → 401; wrong domain/expired
nonce/foreign chain → 401; wallet link requires re-check; all link/verify writes audit rows;
2FA-enabled accounts still require the second factor; cross-building specs unchanged.

---

## Feature 2 — Passkeys / WebAuthn P0

**Problem.** Phishing-resistant login is table stakes for enterprise; passwords stay the
weakest link.

**Design.** Module `apps/api/src/passkeys/` (dep: `@simplewebauthn/server`).
- `POST /auth/passkeys/register-options` / `register-verify`; `POST /auth/passkeys/login-options`
  / `login-verify`. Challenge stored hashed, 60s TTL, single-use.
- Credential per device (like `RefreshSession`): `PasskeyCredential` with `credentialId`
  (base64url), `publicKey`, `signCount`, `transports`, `backedUp`, `deviceName`.
- Passkey satisfies MFA and the step-up re-check used by wallet link / password change.
- Max 10 credentials/user, revocable from `/settings/security` (existing security page).
- Optional passwordless policy per building (`Building.passkeyOnly`).

**Acceptance.** RFC-4226/6238-style vectors pass; zero-password login works; revoke kills the
ceremony; `signCount` regression (cloned authenticator) rejected.

---

## Feature 3 — Greek gov eID login P0

**Problem.** Resident identity is self-declared email; invites/open-registration cannot prove
the person matches the `Ownership` record.

**Design.** Module `apps/api/src/gov-eid/` — OIDC bridge (Grnet/TAXISnet; eIDAS node
option). `EidIdentity { userId subjectId idp assuranceLevel verifiedAt }`.
- `GET /auth/gov-eid/start` → redirect; `GET /auth/gov-eid/callback` → verify state+id_token
  → link by verified email or ΑΦΜ to `Ownership` → auto-activate; else admin-approval queue
  (existing invites/occupancy pending flow).
- Env: `EID_ISSUER_URL`, `EID_CLIENT_ID`, `EID_CLIENT_SECRET`, `EID_MODE=off|bridge`
  (default `off` = endpoint returns 501, matching repo mock-driver pattern).
- Assurance levels LOA2/LOA3 recorded; LOA3 satisfies KYC-grade flows (future bank/levy
  features).

**Acceptance.** Verified eID user activates without admin action; unmatched user lands in
pending queue with reason; state/nonce replay → 401; audited.

---

## Feature 4 — SEPA Direct Debit mandates + pre-notification P0

**Problem.** `SEPA_DD` is only a `PaymentMethod` enum value — no mandate lifecycle; recurring
collection for B2B-ish building accounts is manual.

**Design.** Module `apps/api/src/sepa-dd/`.
- Mandate lifecycle: `POST /buildings/:id/sepa/mandates` (generate `B2B Core`/`CORE` XML),
  status `PENDING → ACTIVE → REVOKED`; pre-notification email 14d + 5d before collection
  (reuses `reminders` driver).
- Collection run `POST /buildings/:id/sepa/collect` (admin) + scheduled cron; PSP driver
  (Stripe SEPA or GoCardless payments) with `console` mock default; failed collections
  create `R-transaction` handling → arrears bucket + dunning hook (Feature 5).
- Idempotency: `@@unique([paymentPlanId|invoiceId, dueDate, attempt])`; re-run creates nothing.
- Σ installments always equals mandate amount (reuses `PaymentPlan` math).

**Schema.** `SepaMandate { id buildingId unitId mandateRef creditorId iban status signedAt
revokedAt }`, `SepaCollection { mandateId amountCents currency status runAt failureCode
attempt @@unique([mandateId, runAt, attempt]) }`.

**Acceptance.** Generated XML schema-valid (unit-test the builder); collection idempotent;
failure moves invoice into arrears; revocation blocks future runs; audited.

---

## Feature 5 — Multi-step dunning & collections automation P0

**Problem.** Reminders are single-shot; no escalation ladder, no auto-offered payment plans,
no opt-out tracking.

**Design.** Module `apps/api/src/dunning/`.
- `DunningStep { sequenceId dayOffset channel template body }`, `DunningSequence { buildingId
  name active steps }` (default sequence seeded: -7 email, +3 email+sms, +10 email+push,
  +30 phone-task + auto-offer plan).
- Run cron (reuse scheduler) evaluates unpaid invoices per building, advances steps, skips
  paid/disputed/opted-out/active-plan units, offers `PaymentPlan` at final step.
- Greek SMS ≤160 chars (reuse `sms-templates`), i18n templates (el/en/pt/zh/ja/es).
- `DunningEvent { invoiceId userId step sentAt }` ledger; `POST /preview` dry-run endpoint.

**Acceptance.** Escalation pauses on payment; per-step de-dup (`@@unique([invoiceId, step])`);
opt-out honored; 160-char limit asserted in specs; audited.

---

## Feature 6 — On-chain audit & vote anchoring ⛓️ P1

**Problem.** `AuditLog` hash chain is strong, but a DB admin can still rewrite history; vote
results are legally sensitive.

**Design.** Module `apps/api/src/anchor/`.
- Cron (hourly) builds a Merkle root over new `AuditLog._hash` values (+ closed-vote tally
  hashes) and submits it to an L2 — default Polygon PoS (chainId 137), Hedera alternative —
  via a dedicated signer (`ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY`, `ANCHOR_MODE=off|polygon|
  hedera`, default `off`).
- `AnchorRecord { id buildingId? root txHash chainId blockNumber itemCount anchoredAt }`;
  per-building opt-in `Building.auditAnchoring`.
- `GET /api/audit/verify` extended: local hash chain **and** Merkle inclusion proof against
  stored roots; `/api/audit/verify-anchor/:id` returns the proof.
- RPC outage → park batch locally, exponential retry; writes never block; batch size cap for
  cost (default 500 entries).

**Acceptance.** Tampered row detected offline (unit test with fake chain client); `off` mode =
zero external calls; proofs verify; audited.

---

## Feature 7 — Marketplace escrow + dispute resolution P1

**Problem.** Job awards book `JobCommission` but funds move off-platform; providers distrust
delivery-before-payment.

**Design.** Module `apps/api/src/escrow/`.
- `EscrowHold { jobId bidId payerUserId payeeUserId amountCents status HOLD|RELEASED|
  REFUNDED|DISPUTED releasedAt? }` funded by PSP card checkout (reuse `payments` checkout);
  release requests on `WorkLog` acceptance; auto-release after N days (`ESCROW_AUTO_RELEASE_DAYS`).
- `Dispute { escrowHoldId raisedBy reason status OPEN|EVIDENCE|ARBITRATED resolution }` with
  `DisputeEvent` evidence trail (documents storage); admin arbitration releases or refunds
  with reason (audited).
- Commission captured at release (`JobCommission` reuse); exactly-once enforced by state
  machine + unique constraint.

**Acceptance.** Double release impossible (unit test concurrent release); refund math exact;
dispute transitions forward-only; cross-building 404; audited.

---

## Feature 8 — Enterprise SSO (OIDC + SAML + SCIM) P1

**Problem.** Property managers with many staff need centralized access control and
deprovisioning.

**Design.** Module `apps/api/src/sso/` (deps: `openid-client`, `@node-saml/node-saml`).
- Per-building `SsoConnection { buildingId protocol(OIDC|SAML) metadataUrl idpEntityId
  jitEnabled active }`; `SsoLink { userId buildingId externalId }`.
- `GET /auth/sso/:buildingSlug/start` → redirect; callback → verify → JIT provision with
  group→role mapping (default `RESIDENT`; `ADMIN`/`BUILDING_OWNER` for mapped groups) →
  same JWT minting.
- SCIM 2.0 `/scim/v2/Users` (+ `/Groups` read): create/deprovision; deprovision revokes
  `RefreshSession`s (reuse sessions service).
- Domain-based IdP routing by email domain (`SsoDomain { domain connectionId }`).

**Acceptance.** IdP login lands in correct building; replayed state → 401; deprovisioned user
cannot refresh; unknown groups default to least privilege; audited.

---

## Feature 9 — Soulbound membership tokens & verifiable credentials ⛓️ P2

**Problem.** Proxy rights and "is this resident real?" are platform-asserted; no portable proof.

**Design.** Module `apps/api/src/sbt/` + `apps/api/src/verifiable-credentials/`.
- ERC-5192 minimal SBT on Polygon: mint on `Membership`/`Ownership` grant, burn on revoke.
  On-chain metadata is PII-free: `unitRefHash` (salted), millimes bucket, mint block.
  `SBT_MODE=off|polygon` (default `off` → DB-only mirror).
- Re-sync cron reconciles chain state vs DB (drift report).
- Verifiable credentials (W3C VC data model, `did:key` default / `did:polygonid` optional):
  proxy-right VC presented at ballot time, checked against `VotingEligibilityRule`; optional
  ZK ownership proof via Polygon ID (adapter, default off).
- `SoulboundToken { buildingId unitId tokenId contractAddress mintedAt revokedAt }`,
  `VerifiableCredential { userId type payloadHash issuedAt expiresAt revokedAt }`.

**Acceptance.** No PII in tx payloads (spec scans payload); revoked token rejected at vote;
DB↔chain reconciliation surfaces drift; GDPR erasure scrubs off-chain links; audited.

---

## Feature 10 — Stablecoin payments (USDC on Polygon) P2

**Problem.** Diaspora owners pay from abroad with FX fees and card declines.

**Design.** New `PspAdapter` implementation `apps/api/src/payments/crypto.adapter.ts`
(`pspProvider='crypto'`, per-building opt-in).
- `createOrder` → returns deposit address + amount (USDC/USDT, Polygon), `PaymentOrder` with
  `crypto` state; watcher job confirms N blocks → settles invoice idempotently by
  `txHash` (unique); underpayment → PENDING + admin alert; optional off-ramp payout to
  building IBAN (adapter, default off).
- Env: `CRYPTO_PAYMENTS_ENABLED`, `CRYPTO_CHAIN_ID=137`, `CRYPTO_WATCHER_INTERVAL_SEC`,
  `CRYPTO_TREASURY_ADDRESS`, `CRYPTO_OFFRAMP_MODE=off|manual|provider`.
- Mock chain client by default (deterministic fixtures), real client via RPC.

**Acceptance.** Same-tx replay settles once; settlement failure → PENDING + notification;
Viva/Stripe paths unchanged (regression specs); amounts never LLM/chain-recomputed — invoice
totals stay the source of truth; audited.

---

## Feature 11 — Insurance claims workflow P1

**Problem.** `ComplianceItem` tracks policies, but claims are handled in email with no
evidence trail.

**Design.** Module `apps/api/src/insurance-claims/`.
- `InsuranceClaim { buildingId policyRef assetId? jobId? status claimedCents settledCents
openedAt closedAt }` created from a linked compliance item / asset / job;
  `ClaimEvent { claimId kind note amountCents? at }` evidence trail (photos via documents
  storage).
- Forward-only status machine: `DRAFT → SUBMITTED → ASSESSING → OFFERED → SETTLED | REJECTED
  | WITHDRAWN`; settlement links to a `TreasuryEntry` (recovery) — Σ entries = settledCents.
- Insurer correspondence log; expiry of limitation period alert (compliance-style de-dup
  notification).

**Acceptance.** Invalid transition → 409; settlement sums asserted in specs; cross-building
404; audited.

---

## Feature 12 — Resident support desk P1

**Problem.** Repetitive resident questions hit admins directly; no SLA visibility, no
deflection.

**Design.** Module `apps/api/src/support/`.
- `Ticket { buildingId userId subject status assigneeId openedAt slaDueAt closedAt }`,
  `TicketMessage { ticketId authorId body internal }`; categories + macros; attachments via
  documents storage; SLA timers per priority; CSAT survey on close.
- Assistant auto-reply suggestion (reuse RAG `AssistantService` if available — optional hook,
  must degrade to no suggestion).
- Resident `/support` + admin `/admin/support` (UI is follow-up; API + tests now).
- Notifications on assign/reply/escalation (reuse `NotificationsService`).

**Acceptance.** Internal notes invisible to residents (spec); SLA-breach notification fires
once (de-dup); cross-building 404; audited.

---

## Feature 13 — E-signature & document workflow (eIDAS) P1

**Problem.** Assembly minutes and agreements are PDF-only; eIDAS advanced signatures add
legal weight.

**Design.** Module `apps/api/src/esign/`.
- `SignatureRequest { documentId provider message expiresAt }`,
  `SignatureSigner { requestId userId email status }`; providers: `console` (default, marks
  signed with audit note), `local` (PAdES via `node-signpdf` — optional dep), `remote`
  (DocuSign/signaturit adapter behind env).
- Invite signers → sign → completion certificate (PDF with signature panel) stored in
  documents storage; expiry and reminder notifications; forward-only status machine.
- Candidates: `πρακτικό` (assembly minutes), `Agreement`, `Invitation` document kinds.

**Acceptance.** Expiry enforced; status machine forward-only; only invited signers sign;
document tenant-scoped (cross-building 404); audited.

---

## Feature 14 — Accounting integrations P1

**Problem.** Accountants re-key data; CSV export is the only bridge.

**Design.** Module `apps/api/src/accounting/`.
- `AccountingConnection { buildingId provider realmId tokens }` (tokens encrypted at rest —
  reuse existing crypto helpers or KMS envelope; never log).
- OAuth connect/callback per provider (QuickBooks Online, Xero; ERP = XML export adapter);
  `AccountMapping { connectionId localKind remoteId }` chart-of-accounts mapping.
- Sync jobs push invoices/payments/expenses; idempotent by remote id (`@@unique` on remote
  doc id); disconnect revokes tokens and stops sync.
- `console`/`mock` connector default (deterministic fixtures), real connectors behind
  `QUICKBOOKS_CLIENT_ID` / `XERO_CLIENT_ID` env.

**Acceptance.** Re-sync creates zero duplicates; unmapped accounts block with actionable
error; disconnect revokes; tokens redacted in logs/audit; audited.

---

## Feature 15 — Sealed-bid e-auction (commit-reveal) P2

**Problem.** Public bid lists invite price matching; Greek tenders expect sealed bids.

**Design.** Extend `apps/api/src/marketplace/`.
- `Job.auctionMode` (`OPEN | SEALED`), `AuctionRound { jobId phase(COMMIT|REVEAL|CLOSED)
closesAt }`; commit = `bidHash = keccak256(salt|qty|amount)`; reveal verifies hash + salt;
  evaluation picks lowest compliant (or weighted score); tie-break deterministic (documented:
  earlier reveal, then hash order).
- Reveal window expiry → unrevealed bids excluded; award flows into existing commission +
  escrow (Feature 7) when enabled.
- `JobBid` gains `commitmentHash`, `sealedAt`, `revealedAt`, `salt` (revealed only).

**Acceptance.** Unrevealed bids excluded from evaluation (spec); hash verification rejects
tampered reveals; result hash reproducible; ties deterministic; audited.

---

## Follow-up wave (16–20, not part of `feat/01`–`feat/15`)

16. Lease & tenancy lifecycle (rent invoicing, deposits, indexation) — `apps/api/src/leases/`
17. IoT smart meters + EPBD ESG reporting — `apps/api/src/iot/`
18. LangGraph agent graphs Phase 3 (nl-sql self-correction, defect classify, praktiko revision)
19. Streaming + multi-turn copilot (SSE `/assistant/stream`, conversations)
20. Mobile native push (FCM/APNs/Expo) + offline sync

---

## Recommended execution order

Wave 1 (identity & revenue): 1, 2, 3, 4, 5 · Wave 2 (trust & money rails): 6, 8, 7, 9, 10 ·
Wave 3 (operations): 11, 12, 13, 14, 15 · Wave 4: 16–20.

Blockchain authentication (#1) lands first because #9 and #10 build on `WalletIdentity`, and
#6 reuses the audit hash chain.
