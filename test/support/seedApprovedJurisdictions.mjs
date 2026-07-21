// Jurisdiction compliance (026) fail-closes STR/SR by default (see server/lib/jurisdiction-compliance.mjs)
// -- production seeds Syria as BLOCKED per an explicit owner instruction, but the existing test suite
// was written before that gate existed and assumes "the market is fine, test the feature." Seed Syria
// as APPROVED for every test run so those tests keep exercising what they were written to exercise.
// A test that specifically targets the jurisdiction gate itself overrides this row for its own case.
import { db } from '../../server/lib/prisma.mjs'

export async function seedApprovedJurisdictions() {
  for (const division of ['STR', 'SR']) {
    await db().jurisdictionComplianceProfile.upsert({
      where: { division_countryCode_regionCode: { division, countryCode: 'SY', regionCode: '' } },
      create: { division, countryCode: 'SY', regionCode: '', status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
  }
}
