import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// Money-model correction (STR checkout fee total). Regression coverage for two confirmed bugs:
//
// P1-1: a guest is charged more than the total they confirmed at checkout whenever a host sets a
// cleaning fee. booking.amountMinor was the "clean" nightly total only; payments.mjs's
// expectedTotalMinor then added metadata.cleaningFeeMinor a SECOND time at charge time, so a guest
// who paid exactly what they were quoted got PAYMENT_AMOUNT_TOO_LOW.
//
// P1-2: the wizard writes the Québec lodging tax to metadata.taxFeeMinor; every reader (payments.mjs,
// finance-ledger.mjs, guestFeeSummary.ts) checked a different key, metadata.taxesMinor, which is never
// written -- a dead key, always reading 0. Per explicit product decision (2026-07-22), Québec lodging
// tax stays disclosure-only at checkout (see jurisdiction-pricing-compliance.test.mjs's "never added
// on top of the guest's total" tests) -- so this fix is a key-consistency correction, not a new charge.
describe('STR checkout: cleaning fee is charged exactly once, matching the guest-confirmed total', () => {
  let app
  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function registerHost(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function makeStay(host, { priceMinor = 100, metadata = {} } = {}) {
    return db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'اختبار رسوم التنظيف', priceMinor, currency: 'USD', status: 'APPROVED', metadata },
    })
  }

  async function bookAndSetContact(guest, listing, { checkIn, checkOut } = {}) {
    const inDate = checkIn || new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const outDate = checkOut || new Date(inDate.getTime() + 24 * 60 * 60 * 1000)
    const bookRes = await request(app).post('/api/bookings').set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: inDate.toISOString(), checkOut: outDate.toISOString() })
    expect(bookRes.status).toBe(201)
    const booking = bookRes.body.booking
    await request(app).patch(`/api/bookings/${booking.id}/contact`).set('Authorization', `Bearer ${guest.token}`)
      .send({ guestName: 'Fee Test Guest', guestPhone: '+963991110099' })
    return booking
  }

  // Regression test for the confirmed bug: today, booking.amountMinor is the "clean" nightly total
  // only, and payments.mjs's expectedTotalMinor silently requires amountMinor + cleaningFeeMinor at
  // charge time -- so a guest paying exactly what they were quoted/confirmed gets
  // PAYMENT_AMOUNT_TOO_LOW. This test asserts the CORRECT behavior (booking.amountMinor already
  // includes the cleaning fee, and paying exactly that amount is accepted) -- it must FAIL against
  // today's code and PASS once the fix lands.
  it('booking.amountMinor already includes the cleaning fee, and paying exactly that amount is accepted', async () => {
    const host = await registerHost('feefix-host')
    const guest = await registerGuest('feefix-guest')
    const listing = await makeStay(host, { priceMinor: 100, metadata: { cleaningFeeMinor: 20 } })
    const booking = await bookAndSetContact(guest, listing)

    expect(booking.amountMinor).toBe(120) // 100 nightly + 20 cleaning, inclusive from creation

    const res = await request(app).post('/api/payments/local-wallet-proof').set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: booking.amountMinor, providerRef: `feefix-${Date.now()}` })
    expect(res.status).toBe(201)
    expect(res.body.proof.amountMinor).toBe(120)
  })

  it('zero-fee case: a listing with no cleaning fee behaves exactly as before (amountMinor === nightly subtotal)', async () => {
    const host = await registerHost('feezero-host')
    const guest = await registerGuest('feezero-guest')
    const listing = await makeStay(host, { priceMinor: 100 })
    const booking = await bookAndSetContact(guest, listing)

    expect(booking.amountMinor).toBe(100)
    const res = await request(app).post('/api/payments/local-wallet-proof').set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: 100, providerRef: `feezero-${Date.now()}` })
    expect(res.status).toBe(201)
  })

  it('multiple nights: the cleaning fee is added exactly once, not per night', async () => {
    const host = await registerHost('feenights-host')
    const guest = await registerGuest('feenights-guest')
    const listing = await makeStay(host, { priceMinor: 50, metadata: { cleaningFeeMinor: 15 } })
    const checkIn = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const checkOut = new Date(checkIn.getTime() + 4 * 24 * 60 * 60 * 1000) // 4 nights
    const booking = await bookAndSetContact(guest, listing, { checkIn, checkOut })

    expect(booking.amountMinor).toBe(50 * 4 + 15) // 215, cleaning fee flat regardless of night count
  })

  // Retry/idempotency: this codebase deliberately allows multiple submitted proofs on one booking
  // (an admin picks which to approve) -- the real duplication guard is at APPROVAL time, not
  // submission time (see finance-ledger.mjs's approvePaymentProof S3 comment: the booking is claimed
  // atomically on PAYMENT_PENDING, so a second approval can never re-run the split). This test
  // verifies THAT guarantee still holds with the fee-inclusive amount: approving one proof settles
  // the fee exactly once, and a second proof can never ALSO be approved afterward.
  it('retry/idempotency: only one proof can ever be approved for a booking, so the cleaning fee is settled exactly once', async () => {
    const host = await registerHost('feeretry-host')
    const guest = await registerGuest('feeretry-guest')
    const admin = await db().user.create({
      data: { email: uniqueTestEmail('feeretry-admin'), displayName: 'Fee Retry Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
    })
    trackTestUser(admin.id)
    const listing = await makeStay(host, { priceMinor: 100, metadata: { cleaningFeeMinor: 20 } })
    const booking = await bookAndSetContact(guest, listing)

    const first = await request(app).post('/api/payments/local-wallet-proof').set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: 120, providerRef: `feeretry-a-${Date.now()}` })
    expect(first.status).toBe(201)
    const second = await request(app).post('/api/payments/local-wallet-proof').set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: 120, providerRef: `feeretry-b-${Date.now()}` })
    expect(second.status).toBe(201)

    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: first.body.proof.id, actorUserId: admin.id }))
    // The booking is no longer PAYMENT_PENDING, so approving the second proof must be rejected --
    // never a second settlement, never a second commission/host-payout credit for the same fee.
    await expect(
      db().$transaction((tx) => approvePaymentProof(tx, { proofId: second.body.proof.id, actorUserId: admin.id })),
    ).rejects.toMatchObject({ code: 'BOOKING_ALREADY_PAID' })

    const payoutEntries = await db().walletEntry.findMany({ where: { referenceType: 'booking_payout', referenceId: booking.id } })
    expect(payoutEntries).toHaveLength(1)
  })
})

describe('STR checkout: Québec lodging-tax metadata key consistency (disclosure-only, per explicit product decision)', () => {
  let app
  beforeAll(() => { app = testApp() })
  afterAll(async () => { await cleanupTestUsers() })
  afterEach(async () => {
    await db().jurisdictionTaxRate.deleteMany({ where: { country: 'CA', province: 'qc-fee-total-test' } })
  })

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function registerHost(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  it('a Québec listing with only the canonical taxFeeMinor key set is never charged tax at checkout (disclosure-only)', async () => {
    const host = await registerHost('qctax-host')
    const guest = await registerGuest('qctax-guest')
    const farFuture = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000)
    const listing = await db().listing.create({
      data: {
        ownerId: host.user.id, division: 'STAYS', titleAr: 'اختبار الضريبة', priceMinor: 100, currency: 'USD', status: 'APPROVED',
        metadata: {
          country: 'CA', governorate: 'qc-fee-total-test', city: 'montreal', taxFeeMinor: 350,
          citqRegistrationNumber: 'CITQ-TEST-FEE-TOTAL', citqCertificateExpiresAt: farFuture.toISOString(),
        },
      },
    })
    // Booking creation re-checks the CITQ certificate FILE (not just the metadata expiry date) for
    // every Québec STAYS listing -- unrelated to what this test verifies, but required for the
    // booking to be created at all.
    await db().listingDocument.create({
      data: { listingId: listing.id, type: 'CITQ_CERTIFICATE', status: 'ADMIN_REVIEWED_TEST', isCurrent: true, expiresAt: farFuture },
    })
    const checkIn = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    const bookRes = await request(app).post('/api/bookings').set('Authorization', `Bearer ${guest.token}`)
      .send({ listingId: listing.id, checkIn: checkIn.toISOString(), checkOut: new Date(checkIn.getTime() + 24 * 60 * 60 * 1000).toISOString() })
    expect(bookRes.status).toBe(201)
    const booking = bookRes.body.booking

    // No tax added: amountMinor is exactly the nightly subtotal (no cleaning fee here either).
    expect(booking.amountMinor).toBe(100)

    await request(app).patch(`/api/bookings/${booking.id}/contact`).set('Authorization', `Bearer ${guest.token}`)
      .send({ guestName: 'QC Tax Guest', guestPhone: '+963991110098' })
    const res = await request(app).post('/api/payments/local-wallet-proof').set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: 100, providerRef: `qctax-${Date.now()}` })
    expect(res.status).toBe(201)
  })
})
