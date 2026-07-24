// M8 — the guest-facing STR tax capsule, driven by the listing's jurisdiction. This does NOT introduce a
// new tax config: it reuses the existing JurisdictionTaxRate table (via resolveTaxRates) exactly as M1
// reused JurisdictionCommissionPolicy, and reads the jurisdiction's JurisdictionComplianceProfile to
// decide whether an absent rate means "no tax here" or "tax treatment not yet confirmed".
//
// MULTI-COMPONENT: a jurisdiction's tax is a LIST of components, each with its own name (taxType), rate
// (rateParts) and taxable base (calculationBase). Every active JurisdictionTaxRate row for the
// (country, province, municipality, STAY) tuple is one component; the total is the sum of the components.
// This framework is generic (it can later hold Québec's GST+QST as two components) but only the generic
// engine + the Syria profile are wired now — Québec's disclosure-only lodging/GST/QST path stays on its
// own frozen module (server/lib/quebec-stay-tax.mjs) and is NOT touched here.
//
// Two hard rules from the money model:
//  1) PASS-THROUGH — every component is standalone and NEVER part of the commission base (M2 platformFee =
//     accommodation+cleaning only). This module never feeds finance-ledger's split base.
//  2) NEVER a silent zero — a jurisdiction whose profile requires tax but has no counsel-confirmed active
//     rate yet (Syria today: taxRequired && !taxSatisfied) returns status PENDING_CONFIRMATION with a null
//     amount and no components, so the guest sees an explicit "pending confirmation" line, not an implied $0.
//
// GO-LIVE TODO (blocking, do not skip) — today even a RESOLVED tax line is DISCLOSED, not charged: it sits
// OUTSIDE the guest's totalMinor (correct while Syria is pending-confirmation). The moment ANY real rate is
// activated for a live jurisdiction, tax must be COLLECTED: the guest is charged base + Σ(components), the
// platform remits the tax to the authority, and the platform's take (M2) stays base-only. Do NOT activate a
// real JurisdictionTaxRate for a live market without first wiring that collection+remittance path.

import { resolveTaxRates, computeTaxAmountMinor } from './jurisdiction-pricing.mjs'
import { getJurisdictionProfile } from './jurisdiction-compliance.mjs'
import { sumMoney } from './currency.mjs'

export const STAY_TAX_LINE_STATUS = {
  RESOLVED: 'RESOLVED', // one or more active, legally-reviewed components apply → real pass-through amounts
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION', // tax required by the jurisdiction profile, no confirmed rate yet
  NONE: 'NONE', // the jurisdiction profile does not require a STR tax line
}

// Each component computes on its own declared taxable base. STAY components use ACCOMMODATION_ONLY (nightly
// subtotal) or TOTAL_BOOKING (the guest's all-inclusive total); FARE_BASE is a RIDE base and never applies
// to a stay, so it falls back to accommodation defensively.
function baseForComponent(calculationBase, { accommodationMinor, totalBookingMinor }) {
  if (calculationBase === 'TOTAL_BOOKING') return totalBookingMinor
  return accommodationMinor // ACCOMMODATION_ONLY (and any non-stay base) → accommodation
}

// dbOrTx: a Prisma client or transaction. Rate resolution keys (country/province/municipality) follow the
// JurisdictionTaxRate specificity model; the profile lookup uses regionCode (Syria = '', Québec = the
// governorate) so the two are never conflated.
export async function resolveStayTaxLine(dbOrTx, { country, province = null, municipality = null, regionCode = '', accommodationMinor = 0, totalBookingMinor = null, currency = 'USD' }) {
  const bases = { accommodationMinor: Math.max(0, Math.round(accommodationMinor || 0)), totalBookingMinor: Math.max(0, Math.round((totalBookingMinor ?? accommodationMinor) || 0)) }
  const activeRows = await resolveTaxRates(dbOrTx, { country, province, municipality, serviceType: 'STAY' })

  if (activeRows.length) {
    // One line PER component ({name, rate, taxableBase}), each computed on its own base and shown separately.
    const components = activeRows.map((row) => ({
      name: row.taxType,
      taxType: row.taxType,
      rateParts: row.rateParts,
      calculationBase: row.calculationBase,
      amountMinor: computeTaxAmountMinor(baseForComponent(row.calculationBase, bases), row.rateParts),
      currency,
      jurisdictionTaxRateId: row.id,
    }))
    // R6: total is the sum of the components through the currency guard (all share the booking currency) —
    // never a raw cross-currency add.
    const total = sumMoney(components.map((c) => ({ amountMinor: c.amountMinor, currency })), currency)
    return { status: STAY_TAX_LINE_STATUS.RESOLVED, amountMinor: total.amountMinor, currency, components }
  }

  const profile = await getJurisdictionProfile(dbOrTx, { division: 'STR', countryCode: country, regionCode })
  if (profile?.taxRequired && !profile.taxSatisfied) {
    return { status: STAY_TAX_LINE_STATUS.PENDING_CONFIRMATION, amountMinor: null, currency, components: [] }
  }
  return { status: STAY_TAX_LINE_STATUS.NONE, amountMinor: 0, currency, components: [] }
}
