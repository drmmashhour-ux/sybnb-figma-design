// One-off setup script (026): seeds the initial JurisdictionComplianceProfile rows and pauses every
// currently-APPROVED Syria STAYS listing, per an explicit owner instruction (2026-07-19) to fail-close
// Syria's STR/SR jurisdiction until local legal review confirms tourism/transport/tax/platform rules,
// modeled the same day Canada/Quebec's profile was seeded from researched official sources. Re-running
// this script is safe: profile upserts are idempotent, and the listing pause only touches rows that
// are still APPROVED (already-paused rows are skipped).
import { db, disconnectDb } from '../server/lib/prisma.mjs'

const TODAY = '2026-07-19'

const PROFILES = [
  {
    division: 'STR',
    countryCode: 'SY',
    regionCode: '',
    status: 'BLOCKED',
    tourismRequired: true, tourismSatisfied: false, tourismNotes: `Fail-closed pending formal local legal review of tourist-accommodation rules (owner instruction, ${TODAY}).`,
    transportRequired: false, transportSatisfied: false, transportNotes: null,
    taxRequired: true, taxSatisfied: false, taxNotes: `Fail-closed pending confirmation of lodging-tax obligations (owner instruction, ${TODAY}).`,
    platformRequired: true, platformSatisfied: false, platformNotes: `Fail-closed pending confirmation of platform-operator registration requirements (owner instruction, ${TODAY}).`,
  },
  {
    division: 'SR',
    countryCode: 'SY',
    regionCode: '',
    status: 'BLOCKED',
    tourismRequired: false, tourismSatisfied: false, tourismNotes: null,
    transportRequired: true, transportSatisfied: false, transportNotes: `Fail-closed pending formal local legal review of ride-hailing/transport rules (owner instruction, ${TODAY}).`,
    taxRequired: true, taxSatisfied: false, taxNotes: `Fail-closed pending confirmation of driver/trip tax obligations (owner instruction, ${TODAY}).`,
    platformRequired: true, platformSatisfied: false, platformNotes: `Fail-closed pending confirmation of platform-operator registration requirements (owner instruction, ${TODAY}).`,
  },
  {
    // STR: modeled from CITQ (tourist accommodation registration), the Montreal municipal bylaw, and
    // Revenu Québec's lodging-tax rules — see src/engines/search/canadaData.ts and
    // server/lib/listing-attributes.mjs. Still PENDING: this profile does not auto-approve Quebec STR,
    // it only records what's been modeled/confirmed so an admin can review and flip status themselves.
    division: 'STR',
    countryCode: 'CA',
    regionCode: 'quebec',
    status: 'PENDING',
    tourismRequired: true, tourismSatisfied: true,
    tourismNotes: 'Modeled from Quebec tourist-accommodation registration (CITQ) rules and the Montreal municipal STR bylaw (seasonal window, banned boroughs). Enforced per-listing: CITQ number + $2M CAD insurance proof required before submission, banned boroughs hard-blocked (SellerListingWizard.tsx, listing-attributes.mjs).',
    transportRequired: false, transportSatisfied: false, transportNotes: null,
    taxRequired: true, taxSatisfied: true,
    taxNotes: '9375-7649 Québec Inc. (NEQ 1173544397) is GST/QST-registered: GST 762614485RT0001, QST 1225519125TQ0002. Revenu Québec 3.5% Tax on Lodging rate confirmed from official source.',
    platformRequired: true, platformSatisfied: false,
    platformNotes: "Revenu Québec's platform-operator lodging-tax-collector registration (form LM-1-V) is a separate filing from GST/QST and has not been confirmed as complete -- required because SYBNB collects guest payment on the host's behalf.",
  },
  {
    // SR: modeled from SAAQ's authorized-driver / qualified-vehicle rules. No Quebec driver onboarding
    // flow exists in the app yet (SR is still hard-geofenced to Syria server-side), so nothing here is
    // implemented in code -- this profile exists so a future SR-in-Quebec launch has to pass through
    // the same admin approval gate as everything else, not ship silently once geofencing is lifted.
    division: 'SR',
    countryCode: 'CA',
    regionCode: 'quebec',
    status: 'PENDING',
    tourismRequired: false, tourismSatisfied: false, tourismNotes: null,
    transportRequired: true, transportSatisfied: false,
    transportNotes: 'Modeled from SAAQ authorized-driver (Class 5 + 12mo experience + French exam + clean record) and qualified-vehicle (age/equipment) rules. Not yet implemented: no Quebec driver onboarding flow, no SAAQ verification field, no French-proficiency check.',
    taxRequired: true, taxSatisfied: true,
    taxNotes: '9375-7649 Québec Inc. (NEQ 1173544397) is GST/QST-registered: GST 762614485RT0001, QST 1225519125TQ0002.',
    platformRequired: true, platformSatisfied: false,
    platformNotes: 'Transport network company / platform-operator registration equivalent for ride-hailing has not been confirmed as complete.',
  },
]

async function main() {
  const upserts = []
  for (const profile of PROFILES) {
    const { division, countryCode, regionCode, ...rest } = profile
    const row = await db().jurisdictionComplianceProfile.upsert({
      where: { division_countryCode_regionCode: { division, countryCode, regionCode } },
      create: { division, countryCode, regionCode, ...rest },
      update: rest,
    })
    upserts.push({ division: row.division, countryCode: row.countryCode, regionCode: row.regionCode, status: row.status })
  }

  // Pause everything now (owner instruction, 2026-07-19): revert every currently-APPROVED Syria
  // STAYS listing to PAUSED so it drops out of guest search/booking immediately (both only ever read
  // status: 'APPROVED' — see server/routes/listings.mjs). Non-STAYS divisions and non-Syria listings
  // are out of scope for this jurisdiction system and are left untouched.
  const approvedSyriaStays = await db().listing.findMany({
    where: { division: 'STAYS', status: 'APPROVED' },
    select: { id: true, metadata: true },
  })
  const toPause = approvedSyriaStays.filter((listing) => {
    const country = listing.metadata && typeof listing.metadata === 'object' ? listing.metadata.country : undefined
    return !country || country === 'SY'
  })
  let pausedCount = 0
  if (toPause.length) {
    const result = await db().listing.updateMany({
      where: { id: { in: toPause.map((listing) => listing.id) }, status: 'APPROVED' },
      data: { status: 'PAUSED' },
    })
    pausedCount = result.count
    await db().adminAuditLog.create({
      data: {
        actorUserId: null,
        action: 'JURISDICTION_PAUSE_ALL',
        entityType: 'listings',
        entityId: 'bulk:syria-str',
        before: { status: 'APPROVED', count: toPause.length },
        after: { status: 'PAUSED', count: pausedCount, reason: `Syria STR jurisdiction set to BLOCKED pending legal review (owner instruction, ${TODAY}).` },
      },
    })
  }

  console.log(JSON.stringify({ profiles: upserts, pausedListingCount: pausedCount }, null, 2))
  await disconnectDb()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
