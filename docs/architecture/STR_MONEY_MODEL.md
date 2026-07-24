# STR Money Model — Authoritative Specification

Date: 2026-07-22. Scope: the STR (STAYS/property-booking) product only — SIR/ride-hailing, Québec
Ride Compliance, CTQ, BNHub, and LECIPM money paths are out of scope and not described here. This
document is the single source of truth for every monetary calculation in STR. If code, a comment,
or a test disagrees with this document, the disagreement is a bug — fix the code to match this
document, or update this document through the same review process as a money-path change, never
silently.

This spec was written after a confirmed production bug (guests charged more than the total they
confirmed at checkout) was found, reproduced, and fixed. Section 4 (Booking Lifecycle) and Section
5 (Checkout Lifecycle) describe the corrected model; the "before" behavior is preserved in `git log`
and in the regression tests, not repeated here as if it were ever the intended design.

---

## 1. Design principles

1. **One canonical function per calculation.** A total is computed in exactly one place
   (`server/lib/pricing.mjs`'s `computeGuestBookingTotalMinor`); every other file that needs that
   total calls it or reads the value it already produced — none re-derives it independently.
2. **What the guest confirms is what the guest pays.** No code path may add a charge the guest was
   not shown before agreeing to pay. If a fee is optional and added later (cancellation protection),
   the guest must have explicitly opted in to it before it is charged.
3. **Server never trusts a client-supplied amount for a real charge.** Every `amountMinor` that
   matters (booking total, Stripe charge, wallet-proof requirement) is computed server-side from the
   listing/booking's own stored data — a client-submitted number is, at most, validated against the
   server's own computed expectation, never substituted for it.
4. **Real money changes are auditable and reversible.** Every settlement, refund, and commission
   reversal happens inside a database transaction with an idempotency key or an atomic status claim,
   so a retry, a race, or a double-click can never double-charge, double-pay, or double-refund.
5. **Disclosure is not collection.** A number can be shown to a guest as an estimate without being
   charged. Québec lodging tax is the concrete example (Section 13) — showing a real, correctly
   computed tax figure is a compliance-readiness step, not by itself a decision to start collecting
   it. Nothing in STR may conflate "we computed and displayed this" with "we charged this."
6. **Test mode never fabricates real financial events.** Nothing in this codebase remits money to a
   government, charges a real card outside Stripe's own test-mode keys, or claims a value was
   "verified"/"collected" unless that specific step actually happened and is independently checked at
   the point of use (see `getOperationalDocumentStatuses`, `STAY_TAX_PLATFORM_COLLECTION`).
7. **A fee is either flat or scaled — never ambiguous.** Every fee's scaling rule is written down
   once (Section 2) and never reinterpreted per call site. Getting this wrong (treating a flat fee
   as per-night) was the direct mechanism of the confirmed bug this document follows from.

---

## 2. Canonical money definitions

Every field below has exactly one meaning across the entire STR codebase. None of these names is
reused for a different concept anywhere in STR-scoped code.

| Field | Meaning | Where computed | Additive to `amountMinor`? |
|---|---|---|---|
| `nightlySubtotalMinor` | Sum of per-night prices across the stay, honoring any host-set per-date price override. Never includes any fee. | `pricing.mjs`'s `computeStayTotalMinor` | — (this *is* the base) |
| `cleaningFeeMinor` | Host-declared flat fee for the whole stay. **Never scaled by night count.** Read from `listing.metadata.cleaningFeeMinor`; absent/invalid → 0. | `pricing.mjs`'s `computeGuestBookingTotalMinor` | Yes |
| `extraFeesMinor` | Generic additional flat fee. No product writer exists today (the host wizard never sets it) — always 0 in current real usage, but the field and its arithmetic are fully wired so it activates the moment a future feature writes it. | `pricing.mjs`'s `computeGuestBookingTotalMinor` | Yes |
| `discountMinor` | **Does not exist as a feature.** No promo/coupon/discount mechanism exists anywhere in STR. Not a column, not a metadata key, not computed anywhere. Documented here so its absence is a decision of record, not an oversight. | N/A | N/A |
| `taxFeeMinor` | Canonical metadata key for Québec lodging tax (3.5%), written by the host wizard, auto-computed there as 3.5% of **one night's** price. | Written: `SellerListingWizard.tsx`. Read (scaled): `pricing.mjs`'s `metadataLodgingTaxMinor` | **No** — disclosure-only (Section 13) |
| `taxesMinor` | **Legacy** metadata key. No writer targets it today. Honored as a fallback wherever `taxFeeMinor` is read, for any pre-existing record that only has this key set. | Read only, same call sites as `taxFeeMinor` | No — same disclosure-only rule |
| `booking.amountMinor` | The **final, all-inclusive guest booking total**, confirmed by the guest at checkout, before any optional cancellation-protection premium. `= nightlySubtotalMinor + cleaningFeeMinor + extraFeesMinor`. Set once, at booking creation; never recomputed afterward for a `PAYMENT_PENDING` booking, never retroactively changed for a paid one. | `bookings.mjs` (creation) | — (this *is* `amountMinor`) |
| `protectionFeeMinor` | Optional cancellation-protection premium: `round(booking.amountMinor × 3%)`. Computed once at booking creation, stored in `booking.metadata.cancellationProtectionFeeMinor`, **never folded into `booking.amountMinor` itself.** | `bookings.mjs` (creation); read at charge time by `payments.mjs` | Added on top, at charge time only |
| `chargedTotalMinor` (logical — no DB column by this name) | What the guest is actually required to pay: `booking.amountMinor + protectionFeeMinor` (if purchased). Computed by `payments.mjs`'s `expectedTotalMinor`. | `payments.mjs` | — |
| `hostPayoutMinor` (returned as `hostGrossMinor`/`hostNetMinor` depending on stage — see Section 9) | What the host receives: `nightlySubtotalMinor + cleaningFeeMinor + extraFeesMinor − platformCommissionMinor`, minus the card-processing fee if the payment method was a card. | `finance-ledger.mjs`'s `bookingFinanceSplit` (gross), `approvePaymentProof` (net, after processing fee) | — |
| `platformCommissionMinor` (returned as `adminCommissionMinor`) | `round((nightlySubtotalMinor + cleaningFeeMinor) × 13%)` — SYBNB's commission, computed on the **accommodation + cleaning** base (M2, 2026-07). **Tax is pass-through and is never part of the base.** The rate is resolved from the STR-scoped `JurisdictionCommissionPolicy` (M1), defaulting to 13%. Changing the base is a deliberate host-economics change and requires host re-consent (M6). | `finance-ledger.mjs`'s `platformFee()` / `bookingFinanceSplit` | — |
| `refundMinor` | Amount actually returned to the guest's wallet on cancellation/dispute: the real paid amount (from the `PaymentProof`, not `booking.amountMinor`), minus any withheld late-cancellation fee, minus the non-refundable protection premium if purchased. | `bookings.mjs`/`host.mjs` (guest/host cancel), `admin.mjs` (dispute ruling) | — |
| `cancellationFeeMinor` | Flat, currency-denominated late-cancellation fee, sourced from `country-config.mjs`'s `strLateCancelFeeMinor`. Withheld from the refund, never billed as a separate debit, capped at the refund amount so a wallet can never go negative. Waived inside the free-cancellation window or when protection was purchased. | `country-config.mjs` (lookup), `bookings.mjs`/`host.mjs` (application) | — |

**Scaling rule, stated once:** `cleaningFeeMinor` and `extraFeesMinor` are flat per booking. `taxFeeMinor`/`taxesMinor` for a Québec listing represents *one night's* tax and must be multiplied by the number of nights wherever it is disclosed as a stay-level figure — this is the one field in the table that is per-night at its metadata-storage granularity but stay-level at its point of use.

---

## 3. Booking lifecycle

```
DRAFT listing → APPROVED listing
      │
      ▼
Guest requests a quote (GET /api/listings/:id/quote)
      │  computeStayTotalMinor → nightlySubtotalMinor
      │  computeGuestBookingTotalMinor → totalMinor (inclusive)
      │  computeQuebecStayTaxesResolved → disclosure-only tax estimate
      ▼
Guest reviews BookingReviewPage — sees the SAME totalMinor as the quote
      │
      ▼
POST /api/bookings
      │  Advisory lock on listing id (prevents double-booking races)
      │  Montreal seasonal/cap check (Québec STAYS only)
      │  Overlap + blocked-date check
      │  computeGuestBookingTotalMinor → booking.amountMinor (server-computed, client amount ignored)
      │  Optional protection fee computed and stored separately
      ▼
Booking created: status PAYMENT_PENDING, amountMinor = final inclusive total
      │
      ▼
Guest pays (Section 5) → status CONFIRMED or REQUESTED (host confirmation required unless Instant Book)
      │
      ▼
Stay occurs → COMPLETED (or CANCELLED via Sections 7/8, or DISPUTED)
```

Nothing between "booking created" and "payment approved" ever changes `amountMinor`. A booking that
is never paid simply expires/cancels with the original quoted amount on record.

---

## 4. Checkout lifecycle

1. `GET /api/listings/:id/quote?checkIn=...&checkOut=...` — returns `totalMinor` (inclusive),
   `breakdown.nightlySubtotalMinor`, `breakdown.cleaningFeeMinor`, `breakdown.extraFeesMinor`, and
   (Québec only) disclosure-only `lodgingTaxMinor`/`gstMinor`/`qstMinor`/`estimatedTaxMinor`.
2. `BookingReviewPage.tsx` renders this exact response: nightly subtotal and cleaning fee as separate
   line items (so the guest sees what makes up the total, not just a lump sum), then the same
   `totalMinor` as "Stay amount," then the optional protection fee, then "Total due" =
   `totalMinor + protectionFeeMinor`.
3. `POST /api/bookings` is called with `checkIn`/`checkOut`/`listingId`/`cancellationProtectionPurchased`
   only — **the client never sends an amount that is trusted.** The server recomputes the identical
   total via the same canonical function and stores it as `booking.amountMinor`.
4. Because steps 1–3 all call the same function with the same inputs, the number the guest saw in
   step 2 and the number stored in step 3 are the same value by construction, not by coincidence.

---

## 5. Payment lifecycle

1. Guest chooses Stripe (card) or a manual wallet proof.
2. Either path computes `expectedTotalMinor(booking)` = `booking.amountMinor + protectionFeeMinor`
   (protection fee read from `booking.metadata`, never recomputed from a rate against a possibly-stale
   base).
3. **Stripe path:** a Checkout Session is created for exactly `expectedTotalMinor`, FX-converted to
   the settlement currency if the booking is SYP-denominated (Section 14). Stripe's webhook confirms
   the real charge; the webhook handler verifies the signature before trusting the event.
4. **Wallet-proof path:** the guest submits a claimed `amountMinor`; the server rejects anything below
   `expectedTotalMinor` (`PAYMENT_AMOUNT_TOO_LOW`) — there is deliberately no ceiling check today
   (documented gap, Section 17).
5. Multiple proofs may be submitted for one booking (no submission-time uniqueness guard) — the real
   safety is at **approval** time (Section 6), not submission time.

---

## 6. Stripe / test-mode lifecycle

- `stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(...) : null` — if no key is configured, the
  Stripe path fails closed with `STRIPE_NOT_CONFIGURED` (503), never silently proceeding as if
  payment succeeded.
- Webhook events are verified via `stripe.webhooks.constructEvent(...)` with
  `STRIPE_WEBHOOK_SECRET` before any booking/payment state changes. An unverified event is rejected.
- The real Stripe-reported processing fee (from the charge's balance transaction) is deducted from
  the **host's** share, never from the platform's commission — the commission is always computed on
  the full accommodation subtotal regardless of payment method.
- In TEST MODE, Stripe's own test-mode keys/cards are used — this codebase does not simulate Stripe
  responses; it calls the real Stripe test API, so test-mode behavior is Stripe's own guarantee, not
  a local mock that could drift from production behavior.

---

## 7. Cancellation lifecycle

- **Guest-initiated** (`PATCH /api/bookings/:id/cancel`): atomically claims the booking status from
  `REQUESTED`/`CONFIRMED` to `CANCELLED` (closes a TOCTOU race against a concurrent host-confirm).
  Free within the free-cancellation window (`STANDARD_FREE_CANCELLATION_DAYS_BEFORE_CHECKIN = 3`) or
  if cancellation protection was purchased (protection waives the late fee, not the protection
  premium itself — the premium is never refunded).
- **Host-initiated** (`PATCH /api/host/requests/:id`): same atomic-claim discipline, same fee/refund
  math, reused via the shared `bookingFinanceSplit`/refund helpers rather than a separate
  implementation.
- Both paths compute the late-cancellation fee via `strLateCancelFeeMinor(currency, country)` — a
  flat fee **in the booking's own currency** (fixing a historical bug where a hardcoded-USD fee could
  drive a SYP guest's empty USD wallet negative) — withheld from the refund, never billed separately,
  and capped at the refund amount.

---

## 8. Refund lifecycle

- The refunded amount is always derived from the **actual paid amount** (`PaymentProof.amountMinor`),
  never re-derived from `booking.amountMinor` when a real payment exists — the two are equal for a
  booking paid in full and unmodified since, but the code deliberately reads the payment record as
  the source of truth for what to reverse.
- Reversal always includes: crediting the guest (net of any late fee/protection premium), debiting
  the admin/platform account for the commission share originally credited (reversed against whoever
  the ledger shows *actually* received it, not a possibly-null `reviewedById`), and — if the host had
  already been paid out — clawing back the host's payout (`admin.mjs`'s dispute-ruling path).
- A dispute-refund and a later guest-cancel on the same booking cannot both pay out: the dispute
  refund atomically cancels the booking first, so a subsequent guest-cancel attempt is rejected
  (`BOOKING_NOT_CANCELLABLE`), not a second refund.

---

## 9. Host payout lifecycle

1. At payment approval (`approvePaymentProof`), `bookingFinanceSplit(booking, proof.amountMinor)`
   decomposes the **actually paid** amount into `stayAmountMinor` (rent), `cleaningFeeMinor`,
   `taxesMinor` (disclosure/reporting only — see Section 13), `adminCommissionMinor`, and
   `hostGrossMinor = stayAmountMinor + cleaningFeeMinor + extraFeesMinor − adminCommissionMinor`.
2. A real Stripe processing fee (card payments only) is deducted from `hostGrossMinor` to produce
   `hostNetMinor` — the commission itself is unaffected by payment method.
3. The host's payout is a wallet `CREDIT` entry, subject to a 14-day hold after checkout
   (`isPayoutEligible`/`payoutEligibleAt` in `booking-lifecycle.mjs`) before it's actually withdrawable.
4. Rent (`stayAmountMinor`) is derived by **direct subtraction** when a cleaning fee is declared
   (`staySplitBase − cleaningFeeMinor − extraFeesMinor`), not by a fixed 1.05-divisor guess — this is
   what makes the split exactly reconstruct the paid total regardless of the declared fee, fixed
   alongside the checkout bug (both were the same root defect: a fixed-rate assumption where a real,
   host-declared value should have been read directly).

---

## 10. Platform commission lifecycle

- Rate: `STR_ADMIN_COMMISSION_RATE = 0.13` (13%), applied to the accommodation subtotal
  (`stayAmountMinor`/`rentMinor`) only — never to the cleaning fee, never to tax, never to the
  protection premium.
- Computed once at settlement (`bookingFinanceSplit`), recorded as a wallet `CREDIT` to the
  platform's admin-share account, and reversed (`DEBIT`) in full on any refund/dispute/cancellation
  that unwinds the booking.
- The commission figure is never shown to the guest (`commission-hidden.test.mjs` enforces this at
  the API-contract level — the guest quote endpoint's response is checked to never contain
  commission/platformFee/hostPayout language).

---

## 11. Ledger lifecycle

- Every money movement is a `WalletEntry` row (`recordWalletEntry` in `finance-ledger.mjs`), typed
  `CREDIT`/`DEBIT`/`RELEASE`/`REFUND`, each carrying a content-derived `idempotencyKey` so a retried
  operation (e.g., a duplicate webhook delivery) can never double-apply.
- `referenceType`/`referenceId` tie every entry back to the booking/dispute/proof that caused it —
  `booking_payout` (host earning), `booking_admin_share` (platform commission), `booking_protection_fee`,
  `booking_refund`, `booking_guest_cancel_fee`, `dispute_refund`, `booking_admin_share_reversal`.
- Wallet balances are a cached, incrementally-updated sum (`Wallet.cachedBalanceMinor`) — always
  derived from the ledger entries, never edited directly.

---

## 12. Receipt generation

- `src/modules/bookings/guestFeeSummary.ts` is the **receipt-display decomposition** — it takes
  `booking.amountMinor` (post-fix, genuinely all-inclusive) and the booking/listing metadata, and
  reconstructs `stayAmountMinor = amountMinor − cleaningFeeMinor − taxesMinor − extraFeesMinor − protectionFeeMinor`
  for display on `BookingDetailPage.tsx`/`BookingCancelDispute.tsx`.
- This is a **display-only** decomposition — it does not move money and does not need to match
  `bookingFinanceSplit`'s numbers exactly in every internal field (that function's `taxesMinor` is a
  settlement-time reporting figure that can legitimately differ from a guest-facing display estimate),
  but `amountMinor` itself — the number both ultimately derive from — is identical everywhere by
  construction.

---

## 13. Québec lodging-tax policy

**Explicit decision (2026-07-22, confirmed with the product owner during this remediation):**
Québec lodging tax (3.5%, and by the same policy GST/QST) stays **disclosure-only** in STR today. It
is computed accurately (via `computeQuebecStayTaxesResolved`, jurisdiction-pricing-aware with a
hardcoded fallback), shown to the guest as an estimate at every point it's relevant, and explicitly
labeled as not collected/not remitted (`collectedTaxMinor: 0`, `remittedTaxMinor: 0`, always) — but
it is **never added to `booking.amountMinor` or any charge**. This is enforced by existing,
passing tests (`jurisdiction-pricing-compliance.test.mjs`'s "never added on top of the guest's
total" assertions) and must not be silently reversed by a future change.

Turning this into a real, collected charge is an explicit **future business/legal decision**
(Invariant 7, Section on invariants below) — it requires: (a) deciding whether STR moves to
tax-inclusive or tax-exclusive pricing, (b) wiring `STAY_TAX_PLATFORM_COLLECTION` (currently always
off) to something real, and (c) a corresponding change to this document, not just a code change.

The `taxFeeMinor`/`taxesMinor` key split exists purely for **consistency and future-readiness**: the
host wizard writes `taxFeeMinor`; every reader now checks `taxFeeMinor` first, falling back to the
legacy `taxesMinor` key. Fixing this key mismatch did not, by itself, start charging tax — it only
made sure the correct number would be available the moment a real decision activates collection.

---

## 14. Currency handling

- Two guest-facing currencies: SYP (platform default) and USD. A listing is priced in one currency
  (`Listing.currency`); a guest may choose to pay in USD regardless of the listing's currency.
- `SYP_PER_USD` (`currency.mjs`) is a fixed, manually-configured rate — not a live market feed.
  Swapping in a real FX feed is a documented future extension point (Section 17).
- Converting a SYP quote to USD rounds **each night individually** up to the nearest $5
  (`USD_ROUNDING_STEP`) and sums the rounded nights — never rounds the lump total once. Rounding the
  lump sum would collapse a multi-night stay's total to the same $5 floor as a single night for any
  listing priced low enough, silently under-charging the guest and under-paying the host.
- A listing already priced in USD is never run through the SYP conversion (which would divide an
  already-dollar figure by 15,000 and collapse it to the rounding floor) — `stayQuoteToRoundedUsd`/
  `amountToRoundedUsd` both check `listingCurrency === 'USD'` before deciding whether to convert.
- Cleaning fee, tax, and extra fees are stored and interpreted in the same currency the wizard
  collected them in (USD, since STAYS listings are always wizard-created in USD today) — see Section
  16 for the known legacy-SYP-listing edge case this does not yet handle.

---

## 15. Rounding rules

- All `amountMinor` fields are **whole currency units**, not cents (a documented $10 fee is stored as
  `10`, not `1000`) — this applies uniformly to SYP and USD alike within this codebase's convention.
- USD amounts guest-facing are always rounded **up** to the nearest $5 (never down, never to the
  nearest) so a guest is never asked for change the platform can't reliably give.
- SYP amounts are never rounded to a step — SYP has no meaningful subunit convention enforced here.
- Every intermediate calculation (`Math.round`, never `Math.floor`/`Math.ceil` except the explicit
  USD-step rounding) uses standard rounding, and every derived total is clamped to a minimum of 0
  (`Math.max(0, ...)`) so a malformed or negative metadata value can never subtract below zero or
  invert a sign.

---

## 16. System invariants

These nine invariants must hold for every STAYS booking, in every environment, at every point in
the lifecycle. Each one cites the exact code path that enforces it and the test that proves it.

| # | Invariant | Enforced by | Proven by |
|---|---|---|---|
| 1 | Guest Confirmed Total == `booking.amountMinor` | `bookings.mjs` creation calls the same `computeGuestBookingTotalMinor` the quote endpoint calls, with the same inputs | `str-checkout-fee-total.test.mjs` (creates via the real quote → booking flow, asserts the stored total) |
| 2 | Stripe Charge == `booking.amountMinor` + optional protection fee | `payments.mjs`'s `expectedTotalMinor` | `str-checkout-fee-total.test.mjs`, `str-security-hardening.test.mjs` (S11/S11b/S11c) |
| 3 | Guest Receipt == Actual Stripe Charge | `guestFeeSummary.ts` decomposes `booking.amountMinor`, which is set to exactly what was charged (Invariant 2) at creation and never altered afterward for a paid booking | Follows from Invariants 1+2 holding transitively; no direct test recomputes a real Stripe charge and compares it byte-for-byte against the receipt (documented gap — see the remediation report's technical-debt list) |
| 4 | Host Payout + Platform Commission == `booking.amountMinor` (for a booking paid in full, no protection) | `bookingFinanceSplit`'s `hostGrossMinor + adminShareMinor === paidTotalMinor` | `finance-ledger.test.mjs` ("host gross + admin share reconstructs the paid amount", both the original and the new cleaning-fee-declared case) |
| 5 | Cleaning Fee is added exactly once | Single call to `computeGuestBookingTotalMinor` at creation; `expectedTotalMinor` no longer re-adds it (the confirmed bug, now fixed) | `str-checkout-fee-total.test.mjs` |
| 6 | Cleaning Fee is never multiplied by nights | `cleaningFeeMinor` is read once as a flat value, added once, regardless of `nights` | `str-checkout-fee-total.test.mjs`'s "multiple nights" case, `finance-ledger.test.mjs`'s "multiple nights" case, `pricing.test.mjs`'s multi-night case |
| 7 | Québec lodging tax remains disclosure-only unless explicitly enabled by a future business/legal decision | `computeGuestBookingTotalMinor` never adds `metadataLodgingTaxMinor`; `expectedTotalMinor` never adds it either | `jurisdiction-pricing-compliance.test.mjs` ("never added on top of the guest's total"), `str-checkout-fee-total.test.mjs` |
| 8 | No calculation path may recompute totals differently | See the repository audit (companion analysis) — every STAYS money path traced to one of: the canonical function, a thin wrapper around it, or a display-only decomposition of an already-known value | Repository audit (this session); `AdminReviewPage.tsx`'s previously-divergent `createShortRentLedger` was the one exception found and fixed |
| 9 | Every payment path (Stripe, wallet-proof) must use the same canonical pricing function | Both paths call the same `expectedTotalMinor`, which itself reads only `booking.amountMinor` (already canonical) + `booking.metadata`'s stored protection fee | `str-security-hardening.test.mjs`, `str-checkout-fee-total.test.mjs` |

Invariant 3 is the one item on this list without a direct, dedicated test recomputing an actual
Stripe charge and comparing it byte-for-byte against the receipt — it currently holds *transitively*
(1 and 2 together imply it) rather than being independently verified end-to-end through a real
Stripe test-mode charge. This is called out explicitly in the technical-debt list rather than quietly
asserted as fully proven.

---

## 17. Future extension points

Documented so a future change lands in the right place rather than creating a new, parallel
calculation path:

- **A promo/discount system**, if ever built, has exactly one place to add `discountMinor`:
  `pricing.mjs`'s `computeGuestBookingTotalMinor`, subtracted after the additive fees, clamped to
  never take the total below the accommodation cost.
- **A live FX feed** replaces `SYP_PER_USD`'s fixed constant in `currency.mjs` only — no other file
  should ever read or cache an exchange rate independently.
- **Real Québec tax collection**, if ever activated, is a change to `STAY_TAX_PLATFORM_COLLECTION`
  plus a corresponding change to `computeGuestBookingTotalMinor` (to actually add
  `metadataLodgingTaxMinor`'s nights-scaled value) and to this document's Section 13 — never a
  change made only at the charge layer (`payments.mjs`) without updating the canonical function and
  the guest-facing quote in the same change.
- **A legacy SYP-currency STAYS listing** with USD-denominated fees (Section 14's noted edge case) —
  not currently handled; any real occurrence should be resolved by migrating the listing to a
  consistent currency, not by adding cross-currency arithmetic to the checkout path.
- **Consolidating the admin-dashboard preview** (`AdminReviewPage.tsx`'s `createShortRentLedger`)
  into a single isomorphic module shared with `finance-ledger.mjs`'s `bookingFinanceSplit`, if the
  build tooling ever supports sharing code between the Node server and the Vite frontend bundle —
  today they are two call-compatible implementations kept in sync by cross-referencing comments, not
  one shared function (see the repository audit for why).
