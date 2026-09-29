# PolykatoikiaOS — Greece + International Market Plan (Europe / North America / South America)

> Purpose: keep the Greek *polykatoikia* product intact and fully functional while making
> the same platform sellable in **Europe (EU + non-EU)**, **North America**, and **South America**.
> Each market differs in: legal basis for apportioning common costs, how money is collected
> (PSP + bank rails), e-invoicing/tax obligations, privacy law, currency, number/date format,
> and language.
>
> Priorities: **P0 = correctness/legal/payment integrity** · **P1 = core UX** · **P2 = growth**.
> All Greek behavior must remain the zero-configuration default (no regressions, existing specs green).

---

## 0. Guiding principles

1. **Greece stays the default.** schema defaults, seed, env, and locale default (`el`) are unchanged.
   International features are opt-in at the *building* and *user* level.
2. **Market = a configuration, not a fork.** Instead of forking code per country, introduce a
   small `Building`-level **market profile** that selects currency, PSP, allocation rules, e-invoice
   adapter, number formatting, and compliance set. One codebase, parameterized by market.
3. **Money stays in minor units (`cents`) internally**; currency is an attribute of a building.
   Convert to display symbols / decimals only at the UI and at the PSP boundary.
4. **Never block Greek flows on international features.** Every internationalization is additive:
   optional columns, optional adapters behind the existing `PspAdapter`/allocation abstractions.

---

## 1. What is Greece-specific today (inventory)

| Area | Current implementation | How hard-coded |
|---|---|---|
| Cost apportionment | `MILIMES` (‰ of 1000, N.1221/1981) as the default `AllocationStrategy`; `shareMillimes`; millimes voting thresholds | schema (`TOTAL_MILLIMES`, `millimes` column), `splitByLargestRemainder` |
| Payments | `PspAdapter` abstraction with `viva` (default) + `stripejp`; `PaymentMethod CARD \| IRIS`; IRIS QR/deep-link; webhook naming assumes Viva | `payments.service.ts`, `viva.adapter.ts`, `stripejp.adapter.ts` |
| E-invoicing | `mydata` module (ΑΑΔΕ myDATA), `MyDataInvoice` with MARKs, `MYDATA_MODE` | `mydata/*`, `SupplierInvoice.issuerAfm` |
| Currency | EUR everywhere: `formatEuros` (el-GR `/100`), `€` symbol, subscriptions in `TIER_PRICES_CENTS` EUR, StripeJP bakes `currency: 'jpy'` | `apps/web/src/app/ui/format.ts`, `subscriptions/pricing.ts`, `stripejp.adapter.ts` |
| Number/date format | `toLocaleString('el-GR')`, comma decimal separators | `format.ts`, charts |
| Legal/compliance | Greek-only kinds (`ΕΛΕΓΚΤΗΣ`, insurance ν.4756/2020), GDPR | `ComplianceKind`, docs §5 |
| Language | `el` default + `en/zh/pt/ja`; `User.locale` | `i18n.service.ts`, `public/i18n/*.json` |
| Building naming | Greek-specific vocab (`polykatoikia`, `Κοινόχρηστα`, `Εκκαθάριση`, assembly `πρακτικό`) | UI strings + translated keys |
| Bank import | GR-bank CSV parser (delimiters, date formats, IBAN-centric reconciliation) | `bank-import/*` |

---

## 2. Market profile data model (the core enabler)

Add a per-building `Building.market` (String) — synthetic **region code**, not free text —
plus a small set of derived settings. Default `"GR"` keeps every existing building on today's path.

```prisma
enum Market { GR EU US MX BR AR CL CO PE }

// New columns on Building (all nullable; GR defaults keep current behavior):
model Building {
  // existing...
  market     String  @default("GR")
  currency   String  @default("EUR")   // ISO-4217 per building
  pspProvider String? @default("viva") // extend allowed set
}
```

A **market registry** (pure config, in `libs/shared`, mirrored server-side) resolves, per market:

| Market | Currency | Default PSP / rails | E-invoice | Number/date locale | Primary languages |
|---|---|---|---|---|---|
| `GR` | EUR | Viva (card + IRIS) | AADE myDATA | `el-GR` | el |
| `EU` (non-GR, e.g. DE/FR/ES/IT/PT/NL/PL/SE) | EUR, PLN, GBP, SEK, CZK… | Stripe SEPA + cards + iDEAL/Bancontact/PayPal (EU rails) | local e-invoice where mandatory (IT FatturaPA, DE XRechnung, FR Factur-X) or standard VAT invoice | `de-DE`, `fr-FR`, `es-ES`, `it-IT`, `pt-PT`, `en-GB`… | localized EU grammars |
| `US` | USD | Stripe (cards + ACH/iDEAL-equivalent bank + Apple/Google Pay) | US sales-tax memo / no mandatory e-invoice; Booking-style receipt | `en-US` | en |
| `CA` | CAD | Stripe (cards + Interac) | GST/HST memo | `en-CA` / `fr-CA` | en, fr |
| `MX` | MXN | Stripe + local OXXO/SPEI (or Mercado Pago) | CFDI — `cfdi` adapter | `es-MX` | es |
| `BR` | BRL | Mercado Pago / Asaas / Stripe + PIX | Nota Fiscal Eletrônica (NFe) for services | `pt-BR` | pt |
| `AR` | ARS | Mercado Pago (PIX-like instant) | CUIT/ingressos brutos memo | `es-AR` | es |
| `CL` | CLP | Mercado Pago / Khipu (WebPay) | boleta/factura electrónica (SII) | `es-CL` | es |
| `CO` / `PE` | COP / PEN | Mercado Pago / local | electronic invoicing where mandated | `es-CO`, `es-PE` | es |

> Non-GR EU capitals differ by country; treat `EU` as a family resolved by `Building.country`
> (add a nullable `country` column). North/South America resolve by market + country too.

**Migration safety:** all new columns default such that existing rows behave exactly as today;
the migration is purely additive (no data rewrite).

---

## 3. Money: currency-aware accounting and display

### 3.1 Internal model (server)
- Keep **all amounts in minor units** (`*Cents`). Introduce a `Building.currency`.
- Add `currency` passthrough to DTOs already carrying amounts (`SubscriptionDto`, `InvoiceDto`, `share` responses, `arrears`, `buildLedger` export).
- Subscriptions: replace hard-coded `TIER_PRICES_CENTS` (EUR) with a **pricing table keyed by tier × currency bucket** (`EUR`/`USD`/`MXN`/`BRL`/`function-like`). Short-term: store `pricePerUnitCents` already per record; add a currency-aware `priceFor(tier, cycle, units, currency)`.
- `SupplierInvoice.currency` already exists (`EUR` default) — generalize seed/default from building.

### 3.2 Display (web)
- Replace `formatEuros(cents)` with `formatMoney(cents, { currency, locale })` backed by **`Intl.NumberFormat`**. Keep `formatEuros` as a thin wrapper for GR so call sites and existing component specs don't churn.
- Factor currency + locale resolution from the active `I18nService` locale **and** the active building's `currency` (available from a `currentBuilding` signal / `BuildingService`).
- Replace hard-coded `€` in templates/components; route number formatting through the new helper.

### 3.3 Reporting & exports (ledger, receipts, annual statements, myDATA XML)
- `buildLedger`, `renderReceipt`, year statements, CSV exports: pass `currency + locale` through; keep GR defaults.

**Exit criteria:** a GR building renders identical to today; a US/BR building renders USD/BRL with
locale-correct separators across invoices, ledger, receipts, and statements.

---

## 4. Payments: multi-PSP, market-rails, and webhook integrity

Current state: `Building.pspProvider` (`viva` | `stripejp` | `gmo`) selected in
`payments.service.startCheckout`; StripeJP adapter exists but bakes `currency: 'jpy'` and `請求書`
(JP strings). The webhook handler is Viva-specific.

### 4.1 Generalize the PSP layer
- Rename/extend the adapter abstraction to be **market-aware**: introduce `StripeGlobalAdapter`
  reusing `StripeJpAdapter` mechanics but taking `{ currency, locale, apiVersion }` and standard
  metadata, so one adapter serves US/CA/MX/BRL/EU card + ACH/PIX via Stripe-local methods.
- Add `MercadoPagoAdapter` (AR/MX/CL/CO/PE preference) behind the same interface; keep a
  `console`/offline driver for sandbox parity (mirrors `RESEND_API_KEY`-empty pattern).
- Resolve adapter by `Building.pspProvider`, not by hard-coded `jpy`.
- **PaymentMethod enum** → allow `PIX`, `ACH`, `SPEI`, `INTERAC`, `SEPA_DD` alongside `CARD|IRIS`
  (enum extension is additive; GR only ever writes `CARD|IRIS`).

### 4.2 Webhooks
- Route incoming webhooks by **provider**, not by assuming Viva. `handleStripeWebhook` already
  exists — make it the shared Stripe path; add Mercado Pago/PIX hook handlers with the same
  **server-side status re-verification** invariant (never trust the payload amount/status).
- Keep the existing Viva webhook public route unchanged (GR regression safety).

### 4.3 Security invariants (all markets)
- Settle via `paidCents` increment inside `$transaction`, idempotent `PaymentOrderState.COMPLETED`
  guard, audit record — already implemented for Viva/Stripe; apply the identical transition to any
  new adapter. Verify amounts against the server-side `PaymentOrder.amountCents`.

**Exit criteria:** a US building completes a Stripe card checkout and reconciles; a BR building does
the same via PIX; existing Viva e2e + `payments.service.spec` pass unchanged.

---

## 5. Cost apportionment: keep millimes (GR) and add market-appropriate strategies

Millimes (‰, N.1221/1981) is legally mandated in Greece. Other markets split common costs by
different bases. All strategies share the existing `splitByLargestRemainder` invariant
(Σ shares ≡ expense total).

### 5.1 Extend `AllocationStrategy`
- Add: `SQUARE_METERS` (area, common in EU/NA), `SHARE_FRACTION` (fractional ownership, common in
  NA condos/HOAs), `%_VALUE` (NA), `HEADCOUNT` / `UNIT_EQUAL` (simple equal split), `METER_USAGE`
  already in schema as `METERS` — wire the existing `Meter`/`MeterReading` module to it.
- Add `Unit.squareMeters Float?` and `Unit.shareFraction Int?` (nullable; GR leaves them null).
- `resolveAllocationWeights` picks weight source by strategy and falls back safely.
- Voting thresholds: keep `MILLIMES_MAJORITY` for GR; generalize to `OWNERSHIP_RIGHTS_MAJORITY`
  that uses `shareFraction`/`squareMeters` weight where millimes is absent.

**Exit criteria:** a US HOA-style building (units with `shareFraction`) allocates a common expense
exactly; a Greek building still splits by millimes with Σ = total.

---

## 6. E-invoicing & tax: myDATA stays GR, other markets get local or none

- Keep the `mydata` module registered **only when `Building.market === 'GR'`** (env `MYDATA_MODE`),
  or gate per-building via the market profile.
- Introduce an **`InvoiceAdapter`** marker interface (extensible): `MyDataAdapter` (GR, existing),
  plus stub/console adapters for markets with optional compliance and documented integration points
  for IT FatturaPA / DE XRechnung / MX CFDI / BR NFe (P2).
- `SupplierInvoice.issuerAfm` (Greek VAT *ΑΦΜ*) → generic `issuerTaxId` (AFM / CUIT / NIT / CVR /
  EIN / PTIN) resolved by market.

**Exit criteria:** GR myDATA path unchanged and green; non-GR buildings produce standard receipts
without a myDATA dependency.

---

## 7. Localization, formatting & languages

- Add **`es`** (critical for MX/AR/CL/CO/PE) and map markets to languages:
  - `GR` → el · `EU` → de/fr/es/it/pt/en · `US`/`CA` → en (+fr-CA) · `MX`/`AR`/`CL`/`CO`/`PE` → es · `BR` → pt.
- Extend `SUPPORTED_LANGUAGES` and add `es.json` (seed from the shared key set; en fallback already runs).
- Number formatting: centralize on `Intl.NumberFormat(locale, { currency })`; remove the
  el-GR hard-codes in `format.ts`.
- Date/currency pref at `User.locale` (persisted) still applies; `Building.currency` only affects
  money rendering. UI legend/help strings switch with locale.

**Exit criteria:** switching a user's locale to `es` renders all translated keys; money in a `MX`
building shows `$` with `es-MX` grouping; GR stays `123,45 €`.

---

## 8. Compliance & privacy

- **GDPR (EU + GR):** existing GDPR module stays for GR + EU (DPA/export/erasure hold). 
- **North America:** add `US` (`CCPA/CPRA`-style right-to-know/deletion) + `CA` (PIPEDA) variants,
  parameterizing the GDPR export/delete module by market label.
- **South America:** `BR` (`LGPD`), `AR` (`Ley 25.326`), `CL/MX/CO/PE` local privacy notes.
- Compliance registry (`ComplianceItem`): make `kind` values market-tagged (GR insurance ν.4756,
  EU building-certs, NA HOA/condo insurance + certificates, SA municipal insurances). Defaults per market.

**Exit criteria:** per-market privacy copy + compliance kinds resolve from `Building.market`;
GR `gdpr` specs unchanged.

---

## 9. Banking import (P2) & PWA/notifications (unchanged)

- GR CSV parser already tolerates decimal commas; add NA (`en-US` `#,##0.00`), EU, and SA bank
  formats as additional parsers behind a `BankImportFormat` resolver keyed by market.
- Email/push templates: parameterize language already (Resend driver); add locale-aware templates.

---

## 10. Rollout phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0-1 ✅ · Currency core (all markets)** | `Building.currency`/`market` + additive migration; `market.ts` registry (GR default); `formatMoney` (Intl) + byte-identical `formatEuros`; currency-bucket pricing | GR unchanged (all specs green); `shared`+`api`+`web` suites pass |
| **P0-2 ✅ · Payments generalization** | `stripe.adapter.ts` (market-aware, configurable currency/locale); `mercadopago.adapter.ts` (Checkout Pro + mock fallback); `PaymentMethod` +`PIX/ACH/SPEI/SEPA_DD/INTERAC` (additive migration); `startCheckout` routes by `pspProvider`; webhook routing by provider (Viva/Stripe/MercadoPago) | US Stripe + BR PIX reconcile (server-side status verified); GR Viva e2e green |
| **P0-3 ✅ · Allocation strategies** | `SQUARE_METERS`/`SHARE_FRACTION` strategies (additive enum + migration); `Unit.squareMeters`/`shareFraction` columns + DTOs + web unit form; `resolveAllocationWeights` scales m² → integer hundredths; generalized ownership-weight basis (`ownership-weights.ts`) used by votes/tenancy/assembly tallies | NA-style split Σ = total; GR millimes regression-proof (all specs green) |
| **P0-3b ✅ · HEADCOUNT / UNIT_EQUAL** | `HEADCOUNT` allocation strategy (weight 1 per unit, ignores millimes); `HEADCOUNT` vote threshold (per-unit quorum + majority) in `tally-vote`/DTOs/quorum + votes/tenancy/assembly tallies; web threshold dropdown + labels | Equal-per-unit split Σ = total; GR millimes/quorum behavior unchanged (all specs green) |
| **P0-3c ✅ · Reserve/levy strategies** | Extraordinary levy creation supports `SQUARE_METERS`/`SHARE_FRACTION` (DTO `IsIn`, `ALLOWED_STRATEGIES`, `resolveAllocationWeights` reuse, unit select); shared `LevyStrategy` + labels; web levy form dropdown + local share preview + helper text | Levy split Σ = total for both strategies; GR MILIMES/UNITS unchanged (all specs green) |
| **P1 · i18n + compliance** | `es` locale; number/date Intl; Market compliance kinds; GR myDATA gating | es.json green; GDPR/LGPD labels by market |
| **P2 · E-invoice adapters + bank import** | CFDI/NFe/FatturaPA stubs; NA/EU/SA bank formats | Non-GR receipt + import paths documented stubs |

No phase alters GR defaults; each phase ends with `api` + `web` tests green.

---

## 11. Risks & guardrails

- **Money correctness:** moving currency into display must never change stored integer values — keep
  all math in `*Cents`; add property tests that `format`/parse round-trips for each currency bucket.
- **Webhook trust:** every new adapter re-verifies server-side status; never settle on payload.
- **Regression:** each migration is additive with defaults; existing unit/e2e specs are the contract —
  `pnpm nx run-many -t test --all` must stay green before and after each phase.
- **Tax scope:** do not claim full multi-jurisdiction tax filing; ship compliant *receipts* + adapter
  seams, mark live e-invoice submission (CFDI/NFe) as credentialed follow-ups.