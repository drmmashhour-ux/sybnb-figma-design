// Tax-compliance foundation (029/030) — Quebec Stay tax calculators. Three separate, official rates:
//   Lodging tax (Revenu Québec "Tax on Lodging" via a digital accommodation platform): 3.5%
//   GST (federal): 5%
//   QST (Quebec): 9.975%
// All three apply ONLY to the qualifying accommodation/nightly-price portion -- never to cleaning
// fees, parking, or other add-on services. This mirrors exactly how the existing lodging-tax-only
// calc already works (SellerListingWizard.tsx's QUEBEC_LODGING_TAX_RATE effect, re-verified in
// listing-attributes.mjs's quebecStrRules) -- GST/QST are computed the same way, on the same base.
//
// These constants are now the FALLBACK DEFAULT only (030): computeQuebecStayTaxesResolved below
// checks server/lib/jurisdiction-pricing.mjs's DB-configured, effective-dated, activation-gated
// JurisdictionTaxRate rows first, and only falls back to these hardcoded numbers when no active row
// exists for the query -- which is every booking today, since nothing is seeded active. So this
// remains the actual, tested calculation path until an admin explicitly activates a DB override.
export const QUEBEC_LODGING_TAX_RATE = 0.035
export const GST_RATE = 0.05
export const QST_RATE = 0.09975

// accommodationMinor is the nightly/rent portion ONLY (bookingFinanceSplit's stayAmountMinor for a
// STAYS booking) -- never the cleaning fee, extra fees, or the cancellation-protection add-on.
export function computeQuebecStayTaxes(accommodationMinor) {
  const base = Math.max(0, Math.round(accommodationMinor || 0))
  return {
    accommodationMinor: base,
    lodgingTaxMinor: Math.round(base * QUEBEC_LODGING_TAX_RATE),
    gstMinor: Math.round(base * GST_RATE),
    qstMinor: Math.round(base * QST_RATE),
  }
}

// Jurisdiction-config-aware version (030): looks up active DB rows for (country, province,
// municipality, STAY) via jurisdiction-pricing.mjs; any tax type NOT found active there falls back
// to the hardcoded rate above. Returns the same shape as computeQuebecStayTaxes, plus a `source`
// map recording which rate (DB row id, or 'fallback-default') produced each figure -- so a pricing
// snapshot can show exactly what was used, not just the numbers.
export async function computeQuebecStayTaxesResolved(db, { accommodationMinor, country, province, municipality }) {
  const { resolveTaxRates, computeTaxAmountMinor } = await import('./jurisdiction-pricing.mjs')
  const base = Math.max(0, Math.round(accommodationMinor || 0))
  const resolved = await resolveTaxRates(db, { country, province, municipality, serviceType: 'STAY' })
  const byType = Object.fromEntries(resolved.map((r) => [r.taxType, r]))

  const lodgingRow = byType.LODGING
  const gstRow = byType.GST
  const qstRow = byType.QST

  return {
    accommodationMinor: base,
    lodgingTaxMinor: lodgingRow ? computeTaxAmountMinor(base, lodgingRow.rateParts) : Math.round(base * QUEBEC_LODGING_TAX_RATE),
    gstMinor: gstRow ? computeTaxAmountMinor(base, gstRow.rateParts) : Math.round(base * GST_RATE),
    qstMinor: qstRow ? computeTaxAmountMinor(base, qstRow.rateParts) : Math.round(base * QST_RATE),
    source: {
      lodging: lodgingRow ? { jurisdictionTaxRateId: lodgingRow.id, ratePercent: lodgingRow.rateParts / 10000 } : { fallback: true, ratePercent: Math.round(QUEBEC_LODGING_TAX_RATE * 100000) / 1000 },
      gst: gstRow ? { jurisdictionTaxRateId: gstRow.id, ratePercent: gstRow.rateParts / 10000 } : { fallback: true, ratePercent: Math.round(GST_RATE * 100000) / 1000 },
      qst: qstRow ? { jurisdictionTaxRateId: qstRow.id, ratePercent: qstRow.rateParts / 10000 } : { fallback: true, ratePercent: Math.round(QST_RATE * 100000) / 1000 },
    },
  }
}

// Who is responsible for GST/QST on this booking, and whether SYBNB actually collected it. Never
// inferred: driven entirely by the host's own explicit TaxProfile.gstQstTreatment decision (see
// server/lib/tax-profile.mjs). No decision on file => UNDETERMINED, which a statement must display
// honestly rather than guess at. platformCollectionActive is the caller-supplied
// STAY_TAX_PLATFORM_COLLECTION feature-flag state (server/lib/compliance-feature-flags.mjs) -- kept
// as a parameter, not read internally, so this stays a pure, easily-testable function.
export function resolveGstQstResponsibility(hostTaxProfile, { platformCollectionActive = false } = {}) {
  const treatment = hostTaxProfile?.gstQstTreatment
  if (!treatment) return { responsibility: 'UNDETERMINED', collectedBySybnb: false }
  if (treatment === 'HOST_REGISTERED') return { responsibility: 'HOST', collectedBySybnb: false }
  // PLATFORM_COLLECTS: the host isn't registered, so the platform is responsible where legally
  // required -- but only actually COLLECTS (adds to what SYBNB charges) once the compliance feature
  // flag is explicitly turned on with a recorded approval. Never true by default.
  return { responsibility: 'PLATFORM', collectedBySybnb: platformCollectionActive === true }
}
