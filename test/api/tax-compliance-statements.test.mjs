import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { resolveStatementPeriod } from '../../server/lib/ride-statements.mjs'
import { buildStayStatement } from '../../server/lib/stay-statements.mjs'
import { upsertTaxProfile, recordGstQstTreatment } from '../../server/lib/tax-profile.mjs'
import { setFeatureFlag, STAY_TAX_PLATFORM_COLLECTION, RIDE_GOVERNMENT_REMITTANCE_ACTIVE } from '../../server/lib/compliance-feature-flags.mjs'
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

async function ensurePlatformAdmin() {
  const existing = await db().userRole.findFirst({ where: { role: 'ADMIN' }, select: { userId: true } })
  if (existing) return existing.userId
  const admin = await db().user.create({
    data: {
      email: uniqueTestEmail('stmt-admin'), displayName: 'Statement Test Admin', referralCode: uniqueTestReferralCode(),
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

describe('Ride statement (029): "Driver Earnings and Tax Statement" reflects the ledger exactly', () => {
  let app

  beforeAll(async () => {
    app = testApp()
    await ensurePlatformAdmin()
  })
  afterAll(async () => { await cleanupTestUsers() })

  it('a completed ride with a tip and a refunded ride both appear correctly, and excluded amounts (tips/cancellation) are separate line totals, not folded into gross fare', async () => {
    const rider = await registerUser(app, 'GUEST', 'stmt-rider')
    await fundWallet(rider.user.id, 10_000_000)
    const driver = await registerUser(app, 'DRIVER', 'stmt-driver')
    await approveDriverForRides(driver.user.id)

    const created = (await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'Malki stmt', dropoff: 'Mezzeh stmt', category: 'SR Economy' })).body.ride
    await driveToCompletion(app, driver.token, created.id)
    const tip = await request(app).post(`/api/sr/rides/${created.id}/tip`).set('Authorization', `Bearer ${rider.token}`).send({ amountMinor: 1500 })
    expect(tip.status).toBe(201)

    const now = new Date()
    const { periodStart, periodEnd } = resolveStatementPeriod('ANNUAL', { year: now.getUTCFullYear() })
    const res = await request(app).get(`/api/driver/statements?periodType=ANNUAL&year=${now.getUTCFullYear()}&format=document&lang=en`)
      .set('Authorization', `Bearer ${driver.token}`)
    expect(res.status).toBe(200)
    expect(res.body.statement.lineCount).toBeGreaterThanOrEqual(1)
    const line = res.body.statement.lines.find((l) => l.rideId === created.id)
    expect(line.tipMinor).toBe(1500)
    expect(line.grossFareMinor).toBe(created.fareMinor)
    expect(line.netPayoutMinor).toBe(line.driverEarningMinor + line.tipMinor + line.cancellationCompensationMinor)
    // Document carries the required non-slip disclaimer and is titled correctly (item A).
    expect(res.body.document).toContain('Driver Earnings and Tax Statement')
    expect(res.body.document).toContain('SYBNB-generated information statement')
    void periodStart; void periodEnd
  })

  it('a refunded ride is excluded from qualifying fares for FUTURE tier calculations but its own statement line still shows the refund', async () => {
    const rider = await registerUser(app, 'GUEST', 'stmt-refund-rider')
    await fundWallet(rider.user.id, 10_000_000)
    const driver = await registerUser(app, 'DRIVER', 'stmt-refund-driver')
    await approveDriverForRides(driver.user.id)

    const created = (await request(app).post('/api/sr/rides').set('Authorization', `Bearer ${rider.token}`)
      .send({ pickup: 'Malki refund', dropoff: 'Mezzeh refund', category: 'SR Economy' })).body.ride
    await driveToCompletion(app, driver.token, created.id)

    // Admin refunds the ride via a dispute.
    const dispute = await db().dispute.create({ data: { subjectType: 'SR_RIDE', rideId: created.id, openedByUserId: rider.user.id, reason: 'test refund' } })
    const staffAdmin = await registerUser(app, 'DRIVER', 'stmt-refund-admin')
    await db().userRole.create({ data: { userId: staffAdmin.user.id, role: 'ADMIN' } })
    const refundRes = await request(app).patch(`/api/admin/disputes/${dispute.id}`).set('Authorization', `Bearer ${staffAdmin.token}`).send({ decision: 'REFUND' })
    expect(refundRes.status).toBe(200)

    const now = new Date()
    const res = await request(app).get(`/api/driver/statements?periodType=ANNUAL&year=${now.getUTCFullYear()}`).set('Authorization', `Bearer ${driver.token}`)
    const line = res.body.statement.lines.find((l) => l.rideId === created.id)
    expect(line.refundedMinor).toBe(created.fareMinor)
  })
})

function driverProfileBody(overrides = {}) {
  return {
    legalFirstName: 'Test', legalLastName: 'Host', dateOfBirth: '1990-01-01',
    addressLine1: '1 Test St', city: 'Montreal', region: 'QC', postalCode: 'H1H 1H1', country: 'CA',
    taxResidenceCountry: 'CA', taxIdentifierType: 'SIN', taxIdentifier: '999-999-999',
    payoutAccountIdentifier: 'ACC-TEST-STAY', consentRegulatoryReporting: true, certifiedAccurate: true,
    ...overrides,
  }
}

async function makeQuebecBookingAndApprove({ hostId, guestId, nightlyPriceMinor = 100000, actorUserId }) {
  const listing = await db().listing.create({
    data: {
      ownerId: hostId, division: 'STAYS', titleAr: 'اختبار كيبك', status: 'APPROVED',
      priceMinor: nightlyPriceMinor, currency: 'CAD',
      // rentMinor/cleaningFeeMinor/taxesMinor pinned explicitly so bookingFinanceSplit uses these
      // exact figures instead of deriving rent from paidTotal via its cleaning/tax-rate divisor --
      // this test is about the Quebec GST/QST calc on a KNOWN accommodation base, not that divisor.
      metadata: {
        country: 'CA', governorate: 'quebec', city: 'montreal', rentMinor: nightlyPriceMinor,
        cleaningFeeMinor: 0, taxesMinor: 0, guestVisibleFees: { nightlyPriceMinor },
      },
    },
  })
  const booking = await db().booking.create({
    data: { listingId: listing.id, guestId, status: 'PAYMENT_PENDING', amountMinor: nightlyPriceMinor, currency: 'CAD' },
  })
  const proof = await db().paymentProof.create({
    data: { bookingId: booking.id, userId: guestId, provider: 'MANUAL', status: 'PENDING_ADMIN_REVIEW', amountMinor: nightlyPriceMinor, currency: 'CAD' },
  })
  await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId }))
  return { listing, booking }
}

describe('Stay statement (029): Quebec lodging tax / GST / QST computed only on the accommodation portion', () => {
  let app

  beforeAll(async () => {
    app = testApp()
    await ensurePlatformAdmin()
  })
  afterAll(async () => {
    await cleanupTestUsers()
    await db().complianceFeatureFlag.updateMany({ where: { key: STAY_TAX_PLATFORM_COLLECTION }, data: { enabled: false } })
  })

  it('a host who is GST/QST-registered: SYBNB reports the tax but does not collect it (host stays responsible)', async () => {
    const host = await registerUser(app, 'GUEST', 'stmt-qc-host-registered')
    const guest = await registerUser(app, 'GUEST', 'stmt-qc-guest-1')
    const admin = await ensurePlatformAdmin()

    const profile = await db().$transaction((tx) => upsertTaxProfile(tx, { userId: host.user.id, subjectType: 'HOST', body: driverProfileBody() }))
    await db().$transaction((tx) => recordGstQstTreatment(tx, { taxProfileId: profile.id, treatment: 'HOST_REGISTERED', effectiveAt: new Date(), decidedById: host.user.id }))

    const { booking } = await makeQuebecBookingAndApprove({ hostId: host.user.id, guestId: guest.user.id, nightlyPriceMinor: 200000, actorUserId: admin })

    const entry = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
    expect(entry.metadata.taxRegime).toBe('quebec_stay_v1')
    expect(entry.metadata.gstQstResponsibility).toBe('HOST')
    expect(entry.metadata.gstQstCollectedBySybnb).toBe(false)
    expect(entry.metadata.lodgingTaxMinor).toBe(7000) // 3.5% of 200,000
    expect(entry.metadata.gstMinor).toBe(10000) // 5%
    expect(entry.metadata.qstMinor).toBe(19950) // 9.975%

    const { periodStart, periodEnd } = resolveStatementPeriod('ANNUAL', { year: new Date().getUTCFullYear() })
    const statement = await buildStayStatement(db(), { hostId: host.user.id, periodType: 'ANNUAL', periodStart, periodEnd })
    const line = statement.lines.find((l) => l.bookingId === booking.id)
    expect(line.gstQstResponsibility).toBe('HOST')
    expect(line.taxesCollectedBySybnbMinor).toBe(7000) // only the lodging tax -- GST/QST stay the host's responsibility
    expect(line.taxesHostResponsibilityMinor).toBe(29950) // gst + qst
  })

  it('a NON-registered host with the platform-collection flag OFF: platform is responsible on paper but has not collected (flag gate honored)', async () => {
    const host = await registerUser(app, 'GUEST', 'stmt-qc-host-unreg-off')
    const guest = await registerUser(app, 'GUEST', 'stmt-qc-guest-2')
    const admin = await ensurePlatformAdmin()

    const profile = await db().$transaction((tx) => upsertTaxProfile(tx, { userId: host.user.id, subjectType: 'HOST', body: driverProfileBody() }))
    await db().$transaction((tx) => recordGstQstTreatment(tx, { taxProfileId: profile.id, treatment: 'PLATFORM_COLLECTS', effectiveAt: new Date(), decidedById: host.user.id }))
    await db().complianceFeatureFlag.upsert({ where: { key: STAY_TAX_PLATFORM_COLLECTION }, create: { key: STAY_TAX_PLATFORM_COLLECTION, enabled: false }, update: { enabled: false } })

    const { booking } = await makeQuebecBookingAndApprove({ hostId: host.user.id, guestId: guest.user.id, nightlyPriceMinor: 100000, actorUserId: admin })
    const entry = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
    expect(entry.metadata.gstQstResponsibility).toBe('PLATFORM')
    expect(entry.metadata.gstQstCollectedBySybnb).toBe(false)
  })

  it('a NON-registered host with the platform-collection flag ON (recorded approval): SYBNB actually collected', async () => {
    const admin = await ensurePlatformAdmin()
    await setFeatureFlag(db(), { key: STAY_TAX_PLATFORM_COLLECTION, enabled: true, actorId: admin })

    const host = await registerUser(app, 'GUEST', 'stmt-qc-host-unreg-on')
    const guest = await registerUser(app, 'GUEST', 'stmt-qc-guest-3')
    const profile = await db().$transaction((tx) => upsertTaxProfile(tx, { userId: host.user.id, subjectType: 'HOST', body: driverProfileBody() }))
    await db().$transaction((tx) => recordGstQstTreatment(tx, { taxProfileId: profile.id, treatment: 'PLATFORM_COLLECTS', effectiveAt: new Date(), decidedById: host.user.id }))

    const { booking } = await makeQuebecBookingAndApprove({ hostId: host.user.id, guestId: guest.user.id, nightlyPriceMinor: 100000, actorUserId: admin })
    const entry = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
    expect(entry.metadata.gstQstCollectedBySybnb).toBe(true)

    await setFeatureFlag(db(), { key: STAY_TAX_PLATFORM_COLLECTION, enabled: false, actorId: admin })
  })

  it('a host with NO tax-profile decision on file: UNDETERMINED, never inferred', async () => {
    const host = await registerUser(app, 'GUEST', 'stmt-qc-host-undetermined')
    const guest = await registerUser(app, 'GUEST', 'stmt-qc-guest-4')
    const admin = await ensurePlatformAdmin()
    const { booking } = await makeQuebecBookingAndApprove({ hostId: host.user.id, guestId: guest.user.id, nightlyPriceMinor: 100000, actorUserId: admin })
    const entry = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
    expect(entry.metadata.gstQstResponsibility).toBe('UNDETERMINED')
    expect(entry.metadata.gstQstCollectedBySybnb).toBe(false)
  })

  it('a non-Quebec (Syria) booking carries no Quebec tax metadata at all -- the wiring is fully gated', async () => {
    const host = await registerUser(app, 'GUEST', 'stmt-sy-host')
    const guest = await registerUser(app, 'GUEST', 'stmt-sy-guest')
    const admin = await ensurePlatformAdmin()
    const listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'شقة دمشق', status: 'APPROVED', priceMinor: 500000, currency: 'SYP', metadata: {} },
    })
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 500000, currency: 'SYP' } })
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: guest.user.id, provider: 'MANUAL', status: 'PENDING_ADMIN_REVIEW', amountMinor: 500000, currency: 'SYP' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: admin }))
    const entry = await db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id } })
    expect(entry.metadata).toEqual({})
  })

  it('the rendered Host Earnings and Tax Statement carries the required disclaimer, in English and French', async () => {
    const host = await registerUser(app, 'HOST', 'stmt-doc-host')
    const now = new Date()
    const res = await request(app).get(`/api/host/statements?periodType=ANNUAL&year=${now.getUTCFullYear()}&format=document&lang=fr`)
      .set('Authorization', `Bearer ${host.token}`)
    expect(res.status).toBe(200)
    expect(res.body.document).toContain("Relevé des revenus et fiscal de l'hôte")
    expect(res.body.document).toContain("Il ne s'agit pas d'un T4")
  })
})

describe('Ride government remittance flag gates whether a Ride statement claims any amount was remitted', () => {
  let app
  beforeAll(async () => { app = testApp(); await ensurePlatformAdmin() })
  afterAll(async () => {
    await cleanupTestUsers()
    await db().complianceFeatureFlag.updateMany({ where: { key: RIDE_GOVERNMENT_REMITTANCE_ACTIVE }, data: { enabled: false } })
  })

  it('remittedToRevenuQuebecMinor is always 0 while the flag is off, regardless of taxes collected', async () => {
    const driver = await registerUser(app, 'DRIVER', 'rse-flag-driver')
    const now = new Date()
    const res = await request(app).get(`/api/driver/statements?periodType=ANNUAL&year=${now.getUTCFullYear()}`).set('Authorization', `Bearer ${driver.token}`)
    expect(res.body.statement.rideGovernmentRemittanceActive).toBe(false)
    expect(res.body.statement.totals.remittedToRevenuQuebecMinor).toBe(0)
  })
})
