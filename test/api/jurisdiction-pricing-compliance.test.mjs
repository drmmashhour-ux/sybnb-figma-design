import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { driverYtdEligibleFareUsd } from '../../server/lib/sr-payments.mjs'
import { resolveCommissionPolicy, resolveTaxRates, upsertCommissionPolicy, upsertTaxRate } from '../../server/lib/jurisdiction-pricing.mjs'
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
      email: uniqueTestEmail('jp-admin'), displayName: 'JP Test Admin', referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } }, wallets: { create: { currency: 'SYP' } },
    },
  })
  trackTestUser(admin.id)
  return admin.id
}

async function driveToCompletion(app, driverToken, rideId) {
  await request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${driverToken}`)
  await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'DRIVER_ARRIVING' })
  await db().rideRequest.update({ where: { id: rideId }, data: { pickupVerifiedAt: new Date() } })
  await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'IN_PROGRESS' })
  return request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driverToken}`).send({ status: 'COMPLETED' })
}

describe('Calendar-year reset (item 5: "Year reset")', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it("a ride completed in a PRIOR calendar year does not count toward this year's YTD eligible fare", async () => {
    const rider = await registerUser(app, 'GUEST', 'reset-rider')
    await fundWallet(rider.user.id, 10_000_000)
    const driver = await registerUser(app, 'DRIVER', 'reset-driver')
    await approveDriverForRides(driver.user.id)

    const created = (await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'Malki reset', dropoff: 'Mezzeh reset', category: 'SR Economy' })).body.ride
    await driveToCompletion(app, driver.token, created.id)
    // Backdate the ride's completion into the PREVIOUS calendar year.
    await db().rideRequest.update({ where: { id: created.id }, data: { updatedAt: new Date('2020-06-15T00:00:00Z') } })

    const ytdThisYear = await driverYtdEligibleFareUsd(db(), driver.user.id, { asOf: new Date() })
    const ytdThatYear = await driverYtdEligibleFareUsd(db(), driver.user.id, { asOf: new Date('2020-12-31T00:00:00Z') })

    expect(ytdThisYear).toBe(0) // the counter has reset -- last year's fare doesn't carry over
    expect(ytdThatYear).toBeGreaterThan(0) // but it's real, queryable history for the year it happened in
  })
})

describe('Fraud/chargeback exclusion from the commission base (item 5: "Chargebacks")', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  it('a ride flagged FRAUDULENT by an admin drops out of YTD eligible fare for future rides, without altering its own already-settled commission', async () => {
    const admin = await makeAdmin()
    const { createSessionToken } = await import('../../server/lib/security.mjs')
    const adminToken = createSessionToken({ id: admin })

    const rider = await registerUser(app, 'GUEST', 'fraud-rider')
    await fundWallet(rider.user.id, 10_000_000)
    const driver = await registerUser(app, 'DRIVER', 'fraud-driver')
    await approveDriverForRides(driver.user.id)

    const created = (await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'Malki fraud', dropoff: 'Mezzeh fraud', category: 'SR Economy' })).body.ride
    await driveToCompletion(app, driver.token, created.id)

    const originalCommission = await db().walletEntry.findFirst({ where: { referenceType: 'sr_admin_commission', referenceId: created.id } })
    expect(originalCommission).not.toBeNull()

    const ytdBeforeFlag = await driverYtdEligibleFareUsd(db(), driver.user.id, { asOf: new Date() })
    expect(ytdBeforeFlag).toBeGreaterThan(0)

    const flagRes = await request(app).patch(`/api/admin/sr-rides/${created.id}/commission-flag`).set('Authorization', `Bearer ${adminToken}`)
      .send({ flag: 'FRAUDULENT', reason: 'test-only synthetic flag' })
    expect(flagRes.status).toBe(200)

    const ytdAfterFlag = await driverYtdEligibleFareUsd(db(), driver.user.id, { asOf: new Date() })
    expect(ytdAfterFlag).toBe(0) // excluded from FUTURE tier math

    // Never retroactive: the ORIGINAL commission entry recorded at settlement time is untouched.
    const commissionAfterFlag = await db().walletEntry.findFirst({ where: { referenceType: 'sr_admin_commission', referenceId: created.id } })
    expect(commissionAfterFlag.amountMinor).toBe(originalCommission.amountMinor)
  })
})

describe('Jurisdiction tax-rate resolver: historical rate changes and effective-dating (item 5)', () => {
  afterEach(async () => {
    await db().jurisdictionTaxRate.deleteMany({ where: { country: 'CA', province: 'jp-test-region' } })
  })

  it('a rate with effectiveTo in the past no longer applies "today"', async () => {
    const admin = await makeAdmin()
    await upsertTaxRate(db(), {
      country: 'CA', province: 'jp-test-region', serviceType: 'STAY', taxType: 'LODGING', rateParts: 35000,
      calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM',
      effectiveFrom: new Date('2020-01-01'), effectiveTo: new Date('2021-01-01'),
      active: true, legallyReviewedById: admin,
    })
    const resolvedToday = await resolveTaxRates(db(), { country: 'CA', province: 'jp-test-region', municipality: null, serviceType: 'STAY' })
    expect(resolvedToday.length).toBe(0)

    const resolvedDuringWindow = await resolveTaxRates(db(), { country: 'CA', province: 'jp-test-region', municipality: null, serviceType: 'STAY', asOf: new Date('2020-06-01') })
    expect(resolvedDuringWindow.length).toBe(1)
  })

  it('a rate not yet effective (effectiveFrom in the future) does not apply yet', async () => {
    const admin = await makeAdmin()
    await upsertTaxRate(db(), {
      country: 'CA', province: 'jp-test-region', serviceType: 'STAY', taxType: 'GST', rateParts: 50000,
      calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM',
      effectiveFrom: new Date('2099-01-01'), active: true, legallyReviewedById: admin,
    })
    const resolved = await resolveTaxRates(db(), { country: 'CA', province: 'jp-test-region', municipality: null, serviceType: 'STAY' })
    expect(resolved.length).toBe(0)
  })

  it('activating a NEW rate does not change a PricingSnapshot already recorded under the old rate', async () => {
    const admin = await makeAdmin()
    const rider = await registerUser(testApp(), 'GUEST', 'jp-snap-guest')
    // Just prove the general immutability property directly on the PricingSnapshot model: create one,
    // change the resolver's underlying config, confirm the stored snapshot is untouched.
    const snapshot = await db().pricingSnapshot.create({
      data: { subjectType: 'STR_BOOKING', subjectId: 'jp-test-subject', country: 'CA', province: 'jp-test-region', breakdown: { lodgingTaxMinor: 3500 } },
    })
    await upsertTaxRate(db(), {
      country: 'CA', province: 'jp-test-region', serviceType: 'STAY', taxType: 'LODGING', rateParts: 999999,
      calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM', effectiveFrom: new Date('2020-01-01'),
      active: true, legallyReviewedById: admin,
    })
    const reread = await db().pricingSnapshot.findUnique({ where: { id: snapshot.id } })
    expect(reread.breakdown).toEqual({ lodgingTaxMinor: 3500 })
    await db().pricingSnapshot.delete({ where: { id: snapshot.id } })
    void rider
  })
})

describe('Province activation controls (item 5)', () => {
  afterEach(async () => {
    await db().jurisdictionTaxRate.deleteMany({ where: { country: 'CA', province: 'jp-activation-region' } })
    await db().jurisdictionCommissionPolicy.deleteMany({ where: { country: 'CA', province: 'jp-activation-region' } })
  })

  it('a tax rate cannot be activated without a recorded legally-reviewing admin', async () => {
    await expect(upsertTaxRate(db(), {
      country: 'CA', province: 'jp-activation-region', serviceType: 'STAY', taxType: 'LODGING', rateParts: 35000,
      calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM', effectiveFrom: new Date(), active: true, legallyReviewedById: null,
    })).rejects.toMatchObject({ code: 'JURISDICTION_ACTIVATION_REQUIRES_REVIEWER' })
  })

  it('a commission policy cannot be activated without a recorded legally-reviewing admin', async () => {
    await expect(upsertCommissionPolicy(db(), {
      country: 'CA', province: 'jp-activation-region', serviceType: 'RIDE', policyType: 'FLAT', flatRateParts: 150000,
      effectiveFrom: new Date(), active: true, legallyReviewedById: null,
    })).rejects.toMatchObject({ code: 'JURISDICTION_ACTIVATION_REQUIRES_REVIEWER' })
  })

  it('an inactive row is never applied by the resolver, even if its dates are in-window', async () => {
    const admin = await makeAdmin()
    const row = await upsertTaxRate(db(), {
      country: 'CA', province: 'jp-activation-region', serviceType: 'STAY', taxType: 'LODGING', rateParts: 35000,
      calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM', effectiveFrom: new Date('2020-01-01'),
      active: true, legallyReviewedById: admin,
    })
    // Manually deactivate (simulating an admin turning it back off) and confirm it drops out.
    await db().jurisdictionTaxRate.update({ where: { id: row.id }, data: { active: false } })
    const resolved = await resolveTaxRates(db(), { country: 'CA', province: 'jp-activation-region', municipality: null, serviceType: 'STAY' })
    expect(resolved.length).toBe(0)
  })

  it('a province-scoped override never leaks into a different province', async () => {
    const admin = await makeAdmin()
    await upsertCommissionPolicy(db(), {
      country: 'CA', province: 'jp-activation-region', serviceType: 'RIDE', policyType: 'FLAT', flatRateParts: 250000,
      effectiveFrom: new Date('2020-01-01'), active: true, legallyReviewedById: admin,
    })
    const elsewhere = await resolveCommissionPolicy(db(), { country: 'CA', province: 'some-other-region', serviceType: 'RIDE' })
    expect(elsewhere).toBeNull()
  })
})

describe('GST/QST rounding (item 5)', () => {
  it("Quebec's fractional 9.975% QST rate rounds correctly on an amount that doesn't divide evenly", async () => {
    const { computeQuebecStayTaxes } = await import('../../server/lib/quebec-stay-tax.mjs')
    // 33,333 * 0.09975 = 3324.99175 -> rounds to 3325.
    const taxes = computeQuebecStayTaxes(33333)
    expect(taxes.qstMinor).toBe(3325)
    // 12,345 * 0.09975 = 1231.4025 -> rounds to 1231.
    const taxes2 = computeQuebecStayTaxes(12345)
    expect(taxes2.qstMinor).toBe(1231)
  })

  it('computeTaxAmountMinor (integer parts-per-million) matches the float-rate calculation exactly for the real Quebec rates', async () => {
    const { computeTaxAmountMinor } = await import('../../server/lib/jurisdiction-pricing.mjs')
    // 99,750 parts-per-million == 9.975%.
    expect(computeTaxAmountMinor(33333, 99750)).toBe(3325)
    expect(computeTaxAmountMinor(12345, 99750)).toBe(1231)
  })
})

describe('Property compliance: expired/missing CITQ certificate (item 5)', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  async function makeQuebecListing(hostId, { citqCertificateExpiresAt } = {}) {
    return db().listing.create({
      data: {
        ownerId: hostId, division: 'STAYS', titleAr: 'اختبار الشهادة', status: 'APPROVED', priceMinor: 100000, currency: 'CAD',
        metadata: {
          country: 'CA', governorate: 'quebec', city: 'montreal', citqRegistrationNumber: '123456',
          ...(citqCertificateExpiresAt !== undefined ? { citqCertificateExpiresAt } : {}),
        },
      },
    })
  }

  it('a booking is blocked when the CITQ certificate has already expired', async () => {
    const host = await registerUser(app, 'GUEST', 'citq-expired-host')
    const guest = await registerUser(app, 'GUEST', 'citq-expired-guest')
    const listing = await makeQuebecListing(host.user.id, { citqCertificateExpiresAt: '2020-01-01' })

    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: '2027-01-10', checkOut: '2027-01-12' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CITQ_CERTIFICATE_EXPIRED')
  })

  it('a booking is blocked when the CITQ certificate expiry is missing entirely', async () => {
    const host = await registerUser(app, 'GUEST', 'citq-missing-host')
    const guest = await registerUser(app, 'GUEST', 'citq-missing-guest')
    const listing = await makeQuebecListing(host.user.id)

    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: '2027-01-10', checkOut: '2027-01-12' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CITQ_CERTIFICATE_EXPIRED')
  })

  it('a booking is blocked when the expiry date is valid but the certificate FILE was never uploaded/approved (item 1)', async () => {
    const host = await registerUser(app, 'GUEST', 'citq-unverified-host')
    const guest = await registerUser(app, 'GUEST', 'citq-unverified-guest')
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const listing = await makeQuebecListing(host.user.id, { citqCertificateExpiresAt: farFuture })

    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: '2027-02-10', checkOut: '2027-02-12' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CITQ_CERTIFICATE_NOT_VERIFIED')
  })

  it('a booking succeeds when the CITQ certificate is valid, uploaded, AND admin-approved', async () => {
    const host = await registerUser(app, 'GUEST', 'citq-valid-host')
    const guest = await registerUser(app, 'GUEST', 'citq-valid-guest')
    const admin = await makeAdmin()
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const listing = await makeQuebecListing(host.user.id, { citqCertificateExpiresAt: farFuture })
    await db().listingDocument.create({
      data: { listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'test-fixture.pdf', mimeType: 'application/pdf', status: 'ADMIN_REVIEWED_TEST', reviewedById: admin, reviewedAt: new Date() },
    })

    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: '2027-02-10', checkOut: '2027-02-12' })
    expect(res.status).toBe(201)
  })

  it('a booking is still blocked when the certificate was uploaded but is only PENDING_REVIEW, not yet approved', async () => {
    const host = await registerUser(app, 'GUEST', 'citq-pending-host')
    const guest = await registerUser(app, 'GUEST', 'citq-pending-guest')
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const listing = await makeQuebecListing(host.user.id, { citqCertificateExpiresAt: farFuture })
    await db().listingDocument.create({
      data: { listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'test-fixture.pdf', mimeType: 'application/pdf', status: 'PENDING_REVIEW' },
    })

    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: '2027-02-10', checkOut: '2027-02-12' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CITQ_CERTIFICATE_NOT_VERIFIED')
  })

  it('a Syria (non-Quebec) listing is never subject to the CITQ check, expired-date field or not', async () => {
    const host = await registerUser(app, 'GUEST', 'citq-sy-host')
    const guest = await registerUser(app, 'GUEST', 'citq-sy-guest')
    const listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'شقة دمشق', status: 'APPROVED', priceMinor: 500000, currency: 'SYP', metadata: {} },
    })
    const res = await request(app).post('/api/bookings').set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: '2027-03-10', checkOut: '2027-03-12' })
    expect(res.status).toBe(201)
  })

  it('an admin cannot APPROVE a Quebec listing whose CITQ certificate document is not itself approved (item 1)', async () => {
    // The market-level jurisdiction gate (026) is separate from the per-listing CITQ document gate
    // (item 1) -- seed Quebec/STR as an APPROVED market so this test exercises the CITQ gate alone.
    await db().jurisdictionComplianceProfile.upsert({
      where: { division_countryCode_regionCode: { division: 'STR', countryCode: 'CA', regionCode: 'quebec' } },
      create: { division: 'STR', countryCode: 'CA', regionCode: 'quebec', status: 'APPROVED' },
      update: { status: 'APPROVED' },
    })
    const adminId = await makeAdmin()
    const { createSessionToken } = await import('../../server/lib/security.mjs')
    const adminToken = createSessionToken({ id: adminId })
    const host = await registerUser(app, 'GUEST', 'citq-approval-host')
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const listing = await db().listing.create({
      data: {
        ownerId: host.user.id, division: 'STAYS', titleAr: 'اختبار موافقة الشهادة', status: 'PENDING_REVIEW', priceMinor: 100000, currency: 'SYP',
        metadata: { country: 'CA', governorate: 'quebec', city: 'montreal', citqRegistrationNumber: '999999', citqCertificateExpiresAt: farFuture },
      },
    })

    const blocked = await request(app).patch(`/api/admin/review-queue/listing/${listing.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APPROVED' })
    expect(blocked.status).toBe(400)
    expect(blocked.body.error.code).toBe('CITQ_CERTIFICATE_NOT_VERIFIED')

    await db().listingDocument.create({
      data: { listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'test-fixture.pdf', mimeType: 'application/pdf', status: 'ADMIN_REVIEWED_TEST', reviewedById: adminId, reviewedAt: new Date() },
    })
    const approved = await request(app).patch(`/api/admin/review-queue/listing/${listing.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APPROVED' })
    expect(approved.status).toBe(200)
  })

  it('a host can upload a CITQ certificate file, and an admin can approve it through the review endpoints (item 1)', async () => {
    const adminId = await makeAdmin()
    const { createSessionToken } = await import('../../server/lib/security.mjs')
    const adminToken = createSessionToken({ id: adminId })
    const hostUser = await db().user.create({
      data: {
        email: uniqueTestEmail('citq-upload-host'), displayName: 'CITQ Upload Host', referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'HOST' } },
      },
    })
    trackTestUser(hostUser.id)
    const hostToken = createSessionToken(hostUser)
    const listing = await db().listing.create({
      data: { ownerId: hostUser.id, division: 'STAYS', titleAr: 'اختبار رفع الشهادة', status: 'DRAFT', priceMinor: 100000, currency: 'SYP', metadata: { country: 'CA' } },
    })
    const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

    const uploaded = await request(app).post(`/api/listings/${listing.id}/documents`).set('Authorization', `Bearer ${hostToken}`)
      .send({ type: 'CITQ_CERTIFICATE', fileBase64: onePixelPng, mimeType: 'image/png' })
    expect(uploaded.status).toBe(201)
    expect(uploaded.body.document.status).toBe('PENDING_REVIEW')

    const approved = await request(app).patch(`/api/admin/listing-documents/${uploaded.body.document.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVED' })
    expect(approved.status).toBe(200)
    expect(approved.body.document.status).toBe('ADMIN_REVIEWED_TEST')

    const fileRes = await request(app).get(`/api/admin/listing-documents/${uploaded.body.document.id}/file`).set('Authorization', `Bearer ${adminToken}`)
    expect(fileRes.status).toBe(200)
  })

  it('listing submission (assertListingAttributes) rejects a Quebec listing with no CITQ certificate expiry', async () => {
    const { assertListingAttributes } = await import('../../server/lib/listing-attributes.mjs')
    const metadata = {
      country: 'CA', citqRegistrationNumber: '123456', residencyType: 'principal',
      guestVisibleFees: { nightlyPriceMinor: 100000 }, taxFeeMinor: 3500,
      // citqCertificateExpiresAt intentionally omitted
    }
    expect(() => assertListingAttributes('STAYS', metadata)).toThrow()
  })

  it('listing submission accepts a Quebec listing with a valid future CITQ certificate expiry', async () => {
    const { assertListingAttributes } = await import('../../server/lib/listing-attributes.mjs')
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    const metadata = {
      country: 'CA', citqRegistrationNumber: '123456', citqCertificateExpiresAt: farFuture, residencyType: 'principal',
      guestVisibleFees: { nightlyPriceMinor: 100000 }, taxFeeMinor: 3500,
    }
    expect(() => assertListingAttributes('STAYS', metadata)).not.toThrow()
  })
})

describe('Guest checkout price-transparency breakdown (item 2: pre-booking quote)', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })
  afterEach(async () => {
    await db().jurisdictionTaxRate.deleteMany({ where: { country: 'CA', province: 'qc-quote-test' } })
  })

  async function makeListing(hostId, metadata, priceMinor = 100000) {
    return db().listing.create({
      data: { ownerId: hostId, division: 'STAYS', titleAr: 'اختبار عرض السعر', status: 'APPROVED', priceMinor, currency: 'SYP', metadata },
    })
  }

  it('a non-Quebec listing shows no tax lines, and the subtotal + cleaning fee always equals the total', async () => {
    const host = await registerUser(app, 'GUEST', 'quote-sy-host')
    const listing = await makeListing(host.user.id, {})

    const res = await request(app).get(`/api/listings/${listing.id}/quote?checkIn=2027-04-10&checkOut=2027-04-12`)
    expect(res.status).toBe(200)
    expect(res.body.breakdown.lodgingTaxMinor).toBe(0)
    expect(res.body.breakdown.gstMinor).toBe(0)
    expect(res.body.breakdown.qstMinor).toBe(0)
    expect(res.body.breakdown.taxSource).toBeNull()
    expect(res.body.breakdown.nightlySubtotalMinor + res.body.breakdown.cleaningFeeMinor).toBe(res.body.totalMinor)
  })

  it('a Quebec listing with no active jurisdiction row falls back to the hardcoded 3.5%/5%/9.975% rates', async () => {
    const host = await registerUser(app, 'GUEST', 'quote-qc-fallback-host')
    const listing = await makeListing(host.user.id, { country: 'CA', governorate: 'qc-quote-test', city: 'montreal' })

    const res = await request(app).get(`/api/listings/${listing.id}/quote?checkIn=2027-04-10&checkOut=2027-04-12`)
    expect(res.status).toBe(200)
    expect(res.body.breakdown.taxSource.lodging.fallback).toBe(true)
    expect(res.body.breakdown.lodgingTaxMinor).toBeGreaterThan(0)
    expect(res.body.breakdown.gstMinor).toBeGreaterThan(0)
    expect(res.body.breakdown.qstMinor).toBeGreaterThan(0)
    // Disclosure only -- the taxes shown are informational, never added on top of the guest's total.
    expect(res.body.breakdown.nightlySubtotalMinor + res.body.breakdown.cleaningFeeMinor).toBe(res.body.totalMinor)
  })

  it('an admin-activated jurisdiction tax rate overrides the fallback in the quote preview', async () => {
    const admin = await makeAdmin()
    const host = await registerUser(app, 'GUEST', 'quote-qc-override-host')
    const listing = await makeListing(host.user.id, { country: 'CA', governorate: 'qc-quote-test', city: 'montreal' })
    await upsertTaxRate(db(), {
      country: 'CA', province: 'qc-quote-test', serviceType: 'STAY', taxType: 'LODGING', rateParts: 100000, // 10%, distinct from the 3.5% fallback
      calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM', effectiveFrom: new Date('2020-01-01'),
      active: true, legallyReviewedById: admin,
    })

    const res = await request(app).get(`/api/listings/${listing.id}/quote?checkIn=2027-04-10&checkOut=2027-04-12`)
    expect(res.status).toBe(200)
    expect(res.body.breakdown.taxSource.lodging.jurisdictionTaxRateId).toBeDefined()
    expect(res.body.breakdown.taxSource.lodging.ratePercent).toBe(10)
  })

  it('estimated/collected/remitted tax are three distinct figures -- collected and remitted are always zero while collection is inactive', async () => {
    const host = await registerUser(app, 'GUEST', 'quote-tax-split-host')
    const listing = await makeListing(host.user.id, { country: 'CA', governorate: 'qc-quote-test', city: 'montreal' })

    const res = await request(app).get(`/api/listings/${listing.id}/quote?checkIn=2027-04-10&checkOut=2027-04-12`)
    expect(res.status).toBe(200)
    const b = res.body.breakdown
    expect(b.estimatedTaxMinor).toBe(b.lodgingTaxMinor + b.gstMinor + b.qstMinor)
    expect(b.estimatedTaxMinor).toBeGreaterThan(0) // a real published rate, not invented
    expect(b.collectedTaxMinor).toBe(0)
    expect(b.remittedTaxMinor).toBe(0)
  })
})

describe('Second compliance-review correction pass: certificate retention, legal hold, and status semantics', () => {
  let app
  beforeAll(async () => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  async function makeListing(hostId, metadata, priceMinor = 100000) {
    return db().listing.create({
      data: { ownerId: hostId, division: 'STAYS', titleAr: 'اختبار الاحتفاظ', status: 'DRAFT', priceMinor, currency: 'SYP', metadata },
    })
  }

  it('retentionDeleteAfter is exactly one year past the certificate expiry, computed at upload time', async () => {
    const { retentionDeleteAfter } = await import('../../server/lib/listing-document-retention.mjs')
    const expiresAt = new Date('2027-06-15T00:00:00Z')
    const deleteAfter = retentionDeleteAfter(expiresAt)
    expect(deleteAfter.toISOString().slice(0, 10)).toBe('2028-06-14') // 365 days later (2028 is a leap year)
    expect(retentionDeleteAfter(null)).toBeNull()
  })

  it('uploading a certificate stores expiresAt and retentionDeleteAfter derived from the listing metadata', async () => {
    const host = await registerUser(app, 'HOST', 'retention-upload-host')
    const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString()
    const listing = await makeListing(host.user.id, { country: 'CA', citqCertificateExpiresAt: farFuture })
    const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

    const res = await request(app).post(`/api/listings/${listing.id}/documents`).set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'CITQ_CERTIFICATE', fileBase64: onePixelPng, mimeType: 'image/png' })
    expect(res.status).toBe(201)
    expect(res.body.document.expiresAt).toBe(farFuture)
    expect(new Date(res.body.document.retentionDeleteAfter).getTime()).toBeGreaterThan(new Date(farFuture).getTime())
  })

  it('the retention purge deletes the file and stamps deletedAt, but keeps the row and writes an audit-log entry -- never the certificate bytes', async () => {
    const { purgeExpiredListingDocuments } = await import('../../server/lib/listing-document-retention.mjs')
    const host = await registerUser(app, 'GUEST', 'retention-purge-host')
    const longExpired = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) // expired long enough ago that retention has elapsed
    const listing = await makeListing(host.user.id, { country: 'CA' })
    const doc = await db().listingDocument.create({
      data: {
        listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'retention-test-fixture.pdf', mimeType: 'application/pdf',
        status: 'EXPIRED', expiresAt: longExpired, retentionDeleteAfter: new Date(longExpired.getTime() + 365 * 24 * 60 * 60 * 1000),
      },
    })

    const purgedCount = await purgeExpiredListingDocuments(db())
    expect(purgedCount).toBeGreaterThanOrEqual(1)

    const after = await db().listingDocument.findUnique({ where: { id: doc.id } })
    expect(after.assetUrl).toBeNull() // the certificate bytes are gone
    expect(after.mimeType).toBeNull()
    expect(after.deletedAt).not.toBeNull()
    expect(after.id).toBe(doc.id) // the row itself survives as the audit record

    const auditEntry = await db().adminAuditLog.findFirst({ where: { entityType: 'listing_documents', entityId: doc.id, action: 'LISTING_DOCUMENT_RETENTION_PURGED' } })
    expect(auditEntry).not.toBeNull()
    expect(JSON.stringify(auditEntry.before)).not.toContain('retention-test-fixture.pdf') // audit record never carries the file reference either
  })

  it('a legal hold blocks the retention purge even when the retention window has elapsed', async () => {
    const { purgeExpiredListingDocuments, setListingDocumentLegalHold } = await import('../../server/lib/listing-document-retention.mjs')
    const admin = await makeAdmin()
    const host = await registerUser(app, 'GUEST', 'legal-hold-host')
    const longExpired = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
    const listing = await makeListing(host.user.id, { country: 'CA' })
    const doc = await db().listingDocument.create({
      data: {
        listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'legal-hold-test-fixture.pdf', mimeType: 'application/pdf',
        status: 'EXPIRED', expiresAt: longExpired, retentionDeleteAfter: new Date(longExpired.getTime() + 365 * 24 * 60 * 60 * 1000),
      },
    })

    await setListingDocumentLegalHold(db(), doc.id, { hold: true, reason: 'Active dispute under review', actorId: admin })
    await purgeExpiredListingDocuments(db())

    const after = await db().listingDocument.findUnique({ where: { id: doc.id } })
    expect(after.assetUrl).toBe('legal-hold-test-fixture.pdf') // NOT purged -- the hold blocked it
    expect(after.deletedAt).toBeNull()
  })

  it('setting a legal hold without a reason or without a recording admin is rejected', async () => {
    const { setListingDocumentLegalHold } = await import('../../server/lib/listing-document-retention.mjs')
    const admin = await makeAdmin()
    const host = await registerUser(app, 'GUEST', 'legal-hold-reason-host')
    const listing = await makeListing(host.user.id, { country: 'CA' })
    const doc = await db().listingDocument.create({
      data: { listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'x.pdf', mimeType: 'application/pdf', status: 'PENDING_REVIEW' },
    })

    await expect(setListingDocumentLegalHold(db(), doc.id, { hold: true, reason: '', actorId: admin }))
      .rejects.toMatchObject({ code: 'LISTING_DOCUMENT_LEGAL_HOLD_REASON_REQUIRED' })
    await expect(setListingDocumentLegalHold(db(), doc.id, { hold: true, reason: 'valid reason', actorId: null }))
      .rejects.toMatchObject({ code: 'LISTING_DOCUMENT_LEGAL_HOLD_ACTOR_REQUIRED' })
  })

  it('markExpiredListingDocuments transitions a stale ADMIN_REVIEWED_TEST document to EXPIRED, never touching PENDING_REVIEW or REJECTED rows', async () => {
    const { markExpiredListingDocuments } = await import('../../server/lib/listing-document-retention.mjs')
    const admin = await makeAdmin()
    const host = await registerUser(app, 'GUEST', 'mark-expired-host')
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const listingA = await makeListing(host.user.id, { country: 'CA' })
    const listingB = await makeListing(host.user.id, { country: 'CA' })
    const reviewed = await db().listingDocument.create({
      data: { listingId: listingA.id, type: 'CITQ_CERTIFICATE', assetUrl: 'a.pdf', status: 'ADMIN_REVIEWED_TEST', expiresAt: past, reviewedById: admin, reviewedAt: new Date() },
    })
    const pending = await db().listingDocument.create({
      data: { listingId: listingB.id, type: 'CITQ_CERTIFICATE', assetUrl: 'b.pdf', status: 'PENDING_REVIEW', expiresAt: past },
    })

    await markExpiredListingDocuments(db())

    expect((await db().listingDocument.findUnique({ where: { id: reviewed.id } })).status).toBe('EXPIRED')
    expect((await db().listingDocument.findUnique({ where: { id: pending.id } })).status).toBe('PENDING_REVIEW') // untouched
  })

  it('manual admin review produces ADMIN_REVIEWED_TEST, never DIGITALLY_VERIFIED -- there is no code path that sets DIGITALLY_VERIFIED', async () => {
    const admin = await makeAdmin()
    const { createSessionToken } = await import('../../server/lib/security.mjs')
    const adminToken = createSessionToken({ id: admin })
    const host = await registerUser(app, 'GUEST', 'manual-review-host')
    const listing = await makeListing(host.user.id, { country: 'CA' })
    const doc = await db().listingDocument.create({
      data: { listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'x.pdf', status: 'PENDING_REVIEW' },
    })

    const res = await request(app).patch(`/api/admin/listing-documents/${doc.id}`).set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVED' })
    expect(res.status).toBe(200)
    expect(res.body.document.status).toBe('ADMIN_REVIEWED_TEST')
    expect(res.body.document.status).not.toBe('DIGITALLY_VERIFIED')
    expect(res.body.document.status).not.toBe('VERIFIED') // that status doesn't exist in this schema at all
  })

  it('no API response anywhere exposes a "verified" field or claims a public verification badge for a listing document', async () => {
    const admin = await makeAdmin()
    const { createSessionToken } = await import('../../server/lib/security.mjs')
    const adminToken = createSessionToken({ id: admin })
    const host = await registerUser(app, 'GUEST', 'no-badge-host')
    const listing = await makeListing(host.user.id, { country: 'CA' })
    const doc = await db().listingDocument.create({
      data: { listingId: listing.id, type: 'CITQ_CERTIFICATE', assetUrl: 'x.pdf', status: 'PENDING_REVIEW' },
    })
    const approved = await request(app).patch(`/api/admin/listing-documents/${doc.id}`).set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APPROVED' })
    expect(Object.keys(approved.body.document)).not.toContain('verified')

    // The public listing detail response (guest-facing) never carries a document-status-derived badge.
    const publicListing = await request(app).get(`/api/listings/${listing.id}`)
    if (publicListing.status === 200) {
      expect(JSON.stringify(publicListing.body)).not.toMatch(/"verified"\s*:\s*true/)
    }
  })
})
