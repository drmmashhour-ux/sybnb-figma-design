// M1 — seed the STR-scoped commission policy: Syria STAY = 13% (exactly 130,000 parts-per-million, which
// round-trips to 0.13 via partsToRatio). This makes the DB JurisdictionCommissionPolicy the single source
// for the STR commission rate; because 130,000 ppm == the STR_ADMIN_COMMISSION_RATE fallback, activating it
// is ZERO behaviour change today. Idempotent (keyed by country+serviceType). NO migration — data only.
//
// effectiveFrom is a fixed past date so the policy is active for current bookings. It does NOT retroactively
// restate already-issued statements: the rate equals the historical fallback, so a recomputation yields the
// same numbers. (A future non-13% change must persist its rate on the Payment/Payout record — see M5 — so
// re-versioning can never desync issued statements; the live-recompute limitation predates M1.)
import { db } from '../server/lib/prisma.mjs'

export const SYRIA_STAY_COMMISSION_PARTS = 130_000 // 13% in parts-per-million (1% = 10,000)

export async function seedStrCommissionPolicy() {
  const existing = await db().jurisdictionCommissionPolicy.findFirst({ where: { country: 'SY', serviceType: 'STAY' } })
  if (existing) {
    return { id: existing.id, created: false, flatRateParts: existing.flatRateParts, active: existing.active }
  }
  const policy = await db().jurisdictionCommissionPolicy.create({
    data: {
      country: 'SY',
      serviceType: 'STAY',
      policyType: 'FLAT',
      flatRateParts: SYRIA_STAY_COMMISSION_PARTS,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      active: true,
      note: 'Founder-confirmed STR commission baseline: 13% (130,000 ppm). Matches the historical STR_ADMIN_COMMISSION_RATE fallback, so activation is zero behaviour change.',
    },
  })
  return { id: policy.id, created: true, flatRateParts: policy.flatRateParts, active: policy.active }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedStrCommissionPolicy()
    .then((r) => { console.log('STR commission policy (Syria STAY):', JSON.stringify(r)); process.exit(0) })
    .catch((e) => { console.error('Seed failed:', e.message); process.exit(1) })
}
