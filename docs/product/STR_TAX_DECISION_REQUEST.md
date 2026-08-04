# P6 — STR Tax: Decision Request (owner / legal)

**Status:** `RED — DECISION REQUIRED` · Prepared 2026-07-27 · No legal/tax conclusion is invented here.
This documents exactly what the code does today and the precise decision needed before launch.

Characterization test (pins current behaviour): `test/api/tax-characterization.test.mjs`.

---

## What the code does today (verified facts)

1. **Rate.** `STR_TAX_RATE = 0.02` (2%), defined identically in `server/lib/finance-ledger.mjs:11` and
   `src/shared/financeModel.ts:6` (frontend mirror). A per-listing `listing.metadata.taxesMinor`
   overrides the flat rate when present.
2. **Applies to.** STAYS bookings only; non-STAYS (cars/marketplace) carry `taxesMinor = 0`.
3. **Server-authoritative charge.** The guest total is computed server-side by `expectedTotalMinor()`
   (`server/routes/payments.mjs:42`) and includes tax. The payment floor (S11,
   `payments.mjs:505`) rejects any proof/charge below that total, so tax cannot be underpaid. The
   Stripe charge and the local-wallet proof both settle the tax-inclusive total.
4. **Where the collected tax goes — the compliance crux.** In `bookingFinanceSplit()`
   (`finance-ledger.mjs:56-75`): `adminShareMinor === taxesMinor + adminCommissionMinor`. The tax the
   guest pays is folded into the platform's `booking_admin_share` CREDIT. **The platform keeps it.**
   There is **no** segregated tax ledger, **no** remittance record, and **no** tax authority payout.
5. **Not persisted as a line item.** Neither `Booking` nor `PaymentProof` has a `taxMinor` column. Tax
   is recomputed from the total via the split; the frozen `tax_profiles` / `jurisdiction_tax_rates` /
   `part_xx_*` tables exist in the schema but are **not** wired to the STR booking/payment path.
6. **Refunds.** A refund returns the full proof `amountMinor` (tax-inclusive). There is no separate tax
   reversal/adjustment because tax was never tracked separately.

**Plain-language summary:** the platform currently collects a flat 2% labelled "tax" from STR guests
and retains it as platform revenue, with no jurisdiction logic and no remittance. Whether that is
acceptable, or must become a real collected-and-remitted tax, is a legal/business decision.

---

## Jurisdiction assumptions that must be confirmed
- Target launch jurisdiction(s) for STR (Syria market — which governorates/municipalities?).
- Whether STR stays are subject to a lodging/occupancy/VAT-type tax there, and at what rate(s).
- Who is the legal collector/remitter (platform vs host) under local law.
- Registration/reporting obligations (tax IDs, filing cadence) — the frozen `tax_profiles` /
  `jurisdiction_tax_rates` models suggest a prior design for this; confirm if it is in launch scope.

## Business facts that must be confirmed
- Is the current 2% a real tax, a platform service fee mislabeled "tax", or a placeholder?
- If real: must it be **remitted** (segregated + paid to an authority) rather than kept as revenue?
- Should tax be a separate, itemised, persisted line on the booking/receipt (invoicing/audit needs)?
- Refund policy for tax (fully refundable with the stay, or non-refundable once remitted?).

## The exact implementation decision required
Choose one:
- **A — Launch with NO tax:** set `STR_TAX_RATE = 0` (and require per-listing `taxesMinor` only where a
  host is a registered collector). Smallest change; removes the "collecting unremitted tax" risk.
- **B — Keep the current 2% but reclassify:** rename the line from "tax" to a platform fee end-to-end
  (guest-facing copy + ledger `referenceType`), so nothing is represented to the guest as tax.
- **C — Implement real collected-and-remitted tax:** persist a `taxMinor` line on booking/payment,
  route it to a segregated tax-liability ledger (not `adminShare`), wire jurisdiction rates
  (reuse `jurisdiction_tax_rates`), and build remittance/reporting. Largest change; needs legal sign-off.

## Tests that depend on the decision (I will build them once A/B/C is chosen)
- **A:** update the characterization test to expect `taxesMinor = 0`; assert no tax line on receipts.
- **B:** assert the guest-facing + ledger labels never say "tax"; the split math is unchanged.
- **C:** new tests — `taxMinor` persisted and equals the charged tax; tax credited to a segregated
  liability ledger (NOT `booking_admin_share`); refund reverses the tax line; jurisdiction-rate lookup;
  rounding; zero-tax jurisdiction; multi-fee interaction; remittance reconciliation.

---

## Single exact owner action that unblocks P6
Reply with **A**, **B**, or **C** (plus, for C, the confirmed jurisdiction rate(s) and legal collector).
Until then P6 stays **RED** and no "tax is handled correctly" launch claim can be made.
