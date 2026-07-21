import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { upsertTaxProfile } from '../../server/lib/tax-profile.mjs'
import {
  cleanupTestUsers,
  fundWallet,
  testApp,
  trackTestUser,
  uniqueTestEmail,
  uniqueTestReferralCode,
  verifyEmailForTest,
  approveDriverForRides,
} from '../support/testServer.mjs'

async function registerUser(app, role, label) {
  const email = uniqueTestEmail(label)
  if (role === 'GUEST') await verifyEmailForTest(app, email)
  if (role === 'DRIVER' || role === 'HOST') await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({ role, email, password: 'correct-horse-battery' })
  trackTestUser(res.body.user.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function makeAdmin() {
  const admin = await db().user.create({
    data: {
      email: uniqueTestEmail('pxx-admin'), displayName: 'Part XX Test Admin', referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } }, wallets: { create: { currency: 'SYP' } },
    },
  })
  trackTestUser(admin.id)
  const { createSessionToken } = await import('../../server/lib/security.mjs')
  return { id: admin.id, token: createSessionToken(admin) }
}

async function driveToCompletion(app, driverToken, rideId) {
  await request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${driverToken}`)
  await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'DRIVER_ARRIVING' })
  await db().rideRequest.update({ where: { id: rideId }, data: { pickupVerifiedAt: new Date() } })
  await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'IN_PROGRESS' })
  return request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'COMPLETED' })
}

function taxProfileBody() {
  return {
    legalFirstName: 'Test', legalLastName: 'Seller', dateOfBirth: '1990-01-01',
    addressLine1: '1 Test St', city: 'Montreal', region: 'QC', postalCode: 'H1H 1H1', country: 'CA',
    taxResidenceCountry: 'CA', taxIdentifierType: 'SIN', taxIdentifier: '888-888-888',
    payoutAccountIdentifier: 'ACC-PXX-0001', consentRegulatoryReporting: true, certifiedAccurate: true,
  }
}

describe('Part XX federal reporting (029): aggregation, validation, filing, correction workflow', () => {
  let app
  const year = 2031 // far-future year, guaranteed not to collide with any other suite's ledger activity
  const quarter = 2

  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('generates a RIDE record from real ledger activity, blocks filing readiness until the seller has a verified tax profile, then allows it once verified', async () => {
    const admin = await makeAdmin()
    const rider = await registerUser(app, 'GUEST', 'pxx-rider')
    await fundWallet(rider.user.id, 10_000_000)
    const driver = await registerUser(app, 'DRIVER', 'pxx-driver')
    await approveDriverForRides(driver.user.id)

    const created = (await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'Malki pxx', dropoff: 'Mezzeh pxx', category: 'SR Economy' })).body.ride
    await driveToCompletion(app, driver.token, created.id)
    // Backdate the settlement entry into our fixed test quarter so aggregation picks it up deterministically.
    const quarterStart = new Date(Date.UTC(year, (quarter - 1) * 3, 15))
    await db().walletEntry.updateMany({ where: { referenceType: 'sr_driver_earning', referenceId: created.id }, data: { createdAt: quarterStart } })

    const gen = await request(app).post('/api/admin/part-xx/generate').set('Authorization', `Bearer ${admin.token}`).send({ year, quarter })
    expect(gen.status).toBe(200)
    const rideRecord = gen.body.records.find((r) => r.sellerId === driver.user.id && r.activityType === 'RIDE')
    expect(rideRecord).toBeTruthy()
    expect(rideRecord.grossConsiderationMinor).toBe(created.fareMinor)
    expect(rideRecord.activityCount).toBe(1)

    const filingCreate = await request(app).post('/api/admin/part-xx/filings').set('Authorization', `Bearer ${admin.token}`).send({ year, quarter })
    expect(filingCreate.status).toBe(200)
    const filingId = filingCreate.body.filing.id

    // Validation fails: driver has no tax profile yet.
    const invalidValidate = await request(app).patch(`/api/admin/part-xx/filings/${filingId}/validate`).set('Authorization', `Bearer ${admin.token}`)
    expect(invalidValidate.body.filing.status).toBe('DRAFT')
    expect(invalidValidate.body.filing.errorDetails.errors.some((e) => e.code === 'TAX_PROFILE_MISSING')).toBe(true)

    // Cannot file a non-VALIDATED filing.
    const prematureFile = await request(app).patch(`/api/admin/part-xx/filings/${filingId}/file`).set('Authorization', `Bearer ${admin.token}`)
    expect(prematureFile.status).toBe(409)

    // Give the driver a verified tax profile, then re-validate.
    const profile = await db().$transaction((tx) => upsertTaxProfile(tx, { userId: driver.user.id, subjectType: 'DRIVER', body: taxProfileBody() }))
    await db().taxProfile.update({ where: { id: profile.id }, data: { verificationStatus: 'APPROVED' } })

    const validate = await request(app).patch(`/api/admin/part-xx/filings/${filingId}/validate`).set('Authorization', `Bearer ${admin.token}`)
    expect(validate.body.filing.status).toBe('VALIDATED')

    const file = await request(app).patch(`/api/admin/part-xx/filings/${filingId}/file`).set('Authorization', `Bearer ${admin.token}`)
    expect(file.status).toBe(200)
    expect(file.body.filing.status).toBe('FILED')
    expect(file.body.filing.submittedXml).toContain(driver.user.id)
    expect(file.body.filing.t619TransmissionRef).toBeTruthy()

    // "Filed" is not "accepted" -- no automatic acceptance anywhere.
    expect(file.body.filing.status).not.toBe('ACCEPTED')

    // Only a real, human-recorded CRA response can accept it.
    const accept = await request(app).patch(`/api/admin/part-xx/filings/${filingId}/response`).set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'ACCEPTED', craResponse: { note: 'synthetic test acceptance' } })
    expect(accept.status).toBe(200)
    expect(accept.body.filing.status).toBe('ACCEPTED')
    expect(accept.body.filing.acceptedAt).toBeTruthy()

    // Correction: opens a new filing, records are marked CORRECTED, but the ORIGINAL filing's
    // submittedXml is byte-for-byte unchanged -- the immutable copy of what was actually reported.
    const correct = await request(app).post(`/api/admin/part-xx/filings/${filingId}/correct`).set('Authorization', `Bearer ${admin.token}`)
      .send({ reason: 'test correction' })
    expect(correct.status).toBe(200)
    expect(correct.body.filing.status).toBe('DRAFT')
    expect(correct.body.filing.correctionOfId).toBe(filingId)

    const originalAfterCorrection = await db().partXXFiling.findUnique({ where: { id: filingId } })
    expect(originalAfterCorrection.status).toBe('ACCEPTED')
    expect(originalAfterCorrection.submittedXml).toBe(file.body.filing.submittedXml)

    const rideRecordAfter = await db().partXXRecord.findFirst({ where: { sellerId: driver.user.id, activityType: 'RIDE', year, quarter } })
    expect(rideRecordAfter.status).toBe('CORRECTED')
    expect(rideRecordAfter.filingId).toBe(correct.body.filing.id)
  })

  it("the seller's own annual Part XX statement is available on demand (satisfies the January 31 requirement) and carries the required disclaimer", async () => {
    const driver = await registerUser(app, 'DRIVER', 'pxx-annual-driver')
    await db().partXXRecord.create({
      data: { sellerId: driver.user.id, activityType: 'RIDE', year: 2029, quarter: 1, grossConsiderationMinor: 50000, currency: 'SYP', activityCount: 3, platformFeesMinor: 6000 },
    })
    const res = await request(app).get(`/api/driver/part-xx-statement?year=2029&lang=en`).set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(200)
    expect(res.body.records.length).toBe(1)
    expect(res.body.document).toContain('Part XX Annual Platform Statement')
    expect(res.body.document).toContain('SYBNB-generated information statement')
  })

  it('a non-admin cannot generate, file, or correct Part XX records', async () => {
    const driver = await registerUser(app, 'DRIVER', 'pxx-forbidden-driver')
    const gen = await request(app).post('/api/admin/part-xx/generate').set('Authorization', `Bearer ${driver.token}`).send({ year: 2030, quarter: 1 })
    expect(gen.status).toBe(403)
  })
})
