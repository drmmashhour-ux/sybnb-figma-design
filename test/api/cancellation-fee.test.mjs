import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// Regression coverage for the fix in server/routes/bookings.mjs: the guest-facing copy
// (src/shared/booking/cancellationPolicy.ts) has always promised "free cancellation until 3 days
// before check-in," but the cancel endpoint used to charge the flat $10 admin fee unconditionally,
// regardless of how far out the guest cancelled. This proves the fee now actually depends on
// timing, matching what guests are told.
describe('PATCH /api/bookings/:id/cancel — cancellation fee depends on timing (bug fix)', () => {
  let app
  let adminId

  beforeAll(async () => {
    app = testApp()
    // ADMIN cannot self-register (PUBLIC_REGISTER_ROLES in server/routes/auth.mjs) -- create it
    // directly instead, same as approvePaymentProof's actorUserId needs any real admin user id.
    const admin = await db().user.create({
      data: {
        email: uniqueTestEmail('cancel-fee-admin-direct'),
        displayName: 'Test Admin',
        referralCode: uniqueTestReferralCode(),
        roles: { create: { role: 'ADMIN' } },
      },
    })
    adminId = admin.id
    trackTestUser(adminId)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function setUpPaidBooking({ checkInDaysFromNow, currency = 'USD', priceMinor = 100_00, metadata = undefined, adminUserId = adminId }) {
    const hostEmail = uniqueTestEmail('cancel-fee-host')
    const legacyVerificationGrant1 = await verifyEmailForTest(app, hostEmail, 'staff-login')
    const hostRes = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant1,
      role: 'HOST',
      email: hostEmail,
      password: 'correct-horse-battery',
    })
    const hostId = hostRes.body.user.id
    trackTestUser(hostId)

    const guestEmail = uniqueTestEmail('cancel-fee-guest')
    const legacyVerificationGrant2 = await verifyEmailForTest(app, guestEmail)
    const guestRes = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant2,
      role: 'GUEST',
      email: guestEmail,
      password: 'correct-horse-battery',
    })
    const guestId = guestRes.body.user.id
    const guestToken = guestRes.body.token
    trackTestUser(guestId)

    const listing = await db().listing.create({
      data: {
        ownerId: hostId,
        division: 'STAYS',
        titleAr: 'اختبار الإلغاء',
        priceMinor,
        currency,
        status: 'APPROVED',
      },
    })

    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + checkInDaysFromNow)

    const booking = await db().booking.create({
      data: {
        listingId: listing.id,
        guestId,
        // PAYMENT_PENDING so approvePaymentProof's S3 status-claim (which requires PAYMENT_PENDING and
        // transitions to CONFIRMED exactly once) runs the real payment path instead of rejecting.
        status: 'PAYMENT_PENDING',
        checkIn,
        checkOut: new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000),
        amountMinor: priceMinor,
        currency,
        ...(metadata ? { metadata } : {}),
      },
    })

    const proof = await db().paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: guestId,
        provider: 'sham_cash',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor: priceMinor,
        currency,
      },
    })

    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: adminUserId }))

    return { bookingId: booking.id, guestId, hostId, guestToken, currency, paidAmount: priceMinor }
  }

  it('charges no cancellation fee when cancelling well before the 3-day cutoff', async () => {
    const { bookingId, guestToken } = await setUpPaidBooking({ checkInDaysFromNow: 30 })

    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set('authorization', `Bearer ${guestToken}`)
      .send({})

    expect(res.status).toBe(200)

    const feeEntry = await db().walletEntry.findFirst({
      where: { referenceType: 'booking_guest_cancel_fee', referenceId: bookingId },
    })
    expect(feeEntry).toBeNull()
  })

  it('withholds the flat fee from the refund (no separate guest debit) when cancelling within 3 days', async () => {
    // Post-fix behavior: the fee is no longer a separate guest DEBIT in USD — it is withheld from the
    // refund and credited to the admin in the BOOKING currency. This USD booking's flat fee is $10.
    const { bookingId, guestId, guestToken } = await setUpPaidBooking({ checkInDaysFromNow: 1 })

    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/cancel`)
      .set('authorization', `Bearer ${guestToken}`)
      .send({})

    expect(res.status).toBe(200)

    // No guest debit at all (that was the negative-wallet bug); the fee is a single admin CREDIT in USD.
    const guestDebit = await db().walletEntry.findFirst({
      where: { referenceType: 'booking_guest_cancel_fee', referenceId: bookingId, type: 'DEBIT' },
    })
    expect(guestDebit).toBeNull()
    const adminFee = await db().walletEntry.findFirst({
      where: { referenceType: 'booking_guest_cancel_fee', referenceId: bookingId, type: 'CREDIT' },
    })
    expect(adminFee).not.toBeNull()
    expect(adminFee.currency).toBe('USD')
    expect(adminFee.amountMinor).toBe(10) // feeMinorUsd
    // The guest's refund is the payment net of the withheld fee (10000 − 10), and never negative.
    const refund = await db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: bookingId } })
    expect(refund.amountMinor).toBe(100_00 - 10)
    const guestUsd = await db().wallet.findUnique({ where: { userId_currency: { userId: guestId, currency: 'USD' } } })
    expect(guestUsd.cachedBalanceMinor).toBe(100_00 - 10)
    expect(guestUsd.cachedBalanceMinor).toBeGreaterThanOrEqual(0)
  })
})

// Currency-mismatch fix (server/routes/bookings.mjs + server/lib/country-config.mjs): the late-cancel fee
// used to be a hardcoded USD DEBIT, driving a SYP guest's empty USD wallet negative. It is now a FLAT fee
// denominated in the booking currency, sourced from country-config, WITHHELD from the refund, and capped
// at the refund so no wallet can go negative.
describe('PATCH /api/bookings/:id/cancel — flat per-currency late-cancel fee (currency-mismatch fix)', () => {
  let app
  const FLAT_FEE_SYP = 50000
  const FLAT_FEE_USD = 10

  beforeAll(() => {
    app = testApp()
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function makeAdmin(label) {
    const admin = await db().user.create({
      data: { email: uniqueTestEmail(label), displayName: 'Cancel Fee Admin', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
    })
    trackTestUser(admin.id)
    return admin.id
  }

  // A paid, confirmed booking with its own fresh admin (so that admin's wallet reflects only this booking —
  // keeps the conservation/fee balance assertions exact).
  async function setUpBooking({ checkInDaysFromNow, currency, priceMinor, metadata = undefined }) {
    const adminUserId = await makeAdmin('cancel-fee2-admin')

    const hostEmail = uniqueTestEmail('cancel-fee2-host')
    const legacyVerificationGrant3 = await verifyEmailForTest(app, hostEmail, 'staff-login')
    const hostId = (await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant3, role: 'HOST', email: hostEmail, password: 'correct-horse-battery' })).body.user.id
    trackTestUser(hostId)

    const guestEmail = uniqueTestEmail('cancel-fee2-guest')
    const legacyVerificationGrant4 = await verifyEmailForTest(app, guestEmail)
    const guestRes = await request(app).post('/api/auth/register').send({ verificationGrant: legacyVerificationGrant4, role: 'GUEST', email: guestEmail, password: 'correct-horse-battery' })
    const guestId = guestRes.body.user.id
    const guestToken = guestRes.body.token
    trackTestUser(guestId)

    const listing = await db().listing.create({
      data: { ownerId: hostId, division: 'STAYS', titleAr: 'اختبار', priceMinor, currency, status: 'APPROVED' },
    })
    const checkIn = new Date()
    checkIn.setUTCDate(checkIn.getUTCDate() + checkInDaysFromNow)
    const booking = await db().booking.create({
      data: {
        listingId: listing.id, guestId, status: 'PAYMENT_PENDING', checkIn,
        checkOut: new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000),
        amountMinor: priceMinor, currency,
        ...(metadata ? { metadata } : {}),
      },
    })
    const proof = await db().paymentProof.create({
      data: { bookingId: booking.id, userId: guestId, provider: 'sham_cash', status: 'PENDING_ADMIN_REVIEW', amountMinor: priceMinor, currency },
    })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: adminUserId }))
    return { bookingId: booking.id, guestId, hostId, adminUserId, guestToken, currency, paidAmount: priceMinor }
  }

  const bal = async (userId, currency) => (await db().wallet.findUnique({ where: { userId_currency: { userId, currency } } }))?.cachedBalanceMinor ?? 0
  const walletRow = async (userId, currency) => db().wallet.findUnique({ where: { userId_currency: { userId, currency } } })
  const cancel = (bookingId, guestToken) => request(app).patch(`/api/bookings/${bookingId}/cancel`).set('authorization', `Bearer ${guestToken}`).send({})

  it('1. late SYP cancel leaves no negative wallet — fee withheld in SYP, admin credited in SYP', async () => {
    const b = await setUpBooking({ checkInDaysFromNow: 1, currency: 'SYP', priceMinor: 100000 })
    const res = await cancel(b.bookingId, b.guestToken)
    expect(res.status).toBe(200)

    // No USD wallet was ever created for this SYP booking (the old hardcoded-USD debit is gone).
    expect(await walletRow(b.guestId, 'USD')).toBeNull()
    // Refund = paid − min(flatFeeSYP, paid); admin got the fee in SYP; nobody is negative.
    expect(await bal(b.guestId, 'SYP')).toBe(100000 - FLAT_FEE_SYP)
    expect(await bal(b.guestId, 'SYP')).toBeGreaterThanOrEqual(0)
    const adminFee = await db().walletEntry.findFirst({ where: { referenceType: 'booking_guest_cancel_fee', referenceId: b.bookingId, type: 'CREDIT' } })
    expect(adminFee.currency).toBe('SYP')
    expect(adminFee.amountMinor).toBe(FLAT_FEE_SYP)
    const refund = await db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: b.bookingId } })
    expect(refund.amountMinor).toBe(100000 - FLAT_FEE_SYP)
  })

  it('2. fee is capped at the refund — a small refund yields feeMinor === refund and a zero (never negative) balance', async () => {
    const paid = 30000 // below the 50000 SYP flat fee
    const b = await setUpBooking({ checkInDaysFromNow: 1, currency: 'SYP', priceMinor: paid })
    const res = await cancel(b.bookingId, b.guestToken)
    expect(res.status).toBe(200)

    const adminFee = await db().walletEntry.findFirst({ where: { referenceType: 'booking_guest_cancel_fee', referenceId: b.bookingId, type: 'CREDIT' } })
    expect(adminFee.amountMinor).toBe(paid) // feeMinor === min(flat, refund) === refund
    expect(await bal(b.guestId, 'SYP')).toBe(0) // net refund 0
    expect(await bal(b.guestId, 'SYP')).toBeGreaterThanOrEqual(0)
    expect(await walletRow(b.guestId, 'USD')).toBeNull()
  })

  it('3. conservation — guest refund + admin fee, net of the reversed admin share, leaves platform total === paid', async () => {
    const paid = 100000
    const b = await setUpBooking({ checkInDaysFromNow: 1, currency: 'SYP', priceMinor: paid })
    const res = await cancel(b.bookingId, b.guestToken)
    expect(res.status).toBe(200)

    const guest = await bal(b.guestId, 'SYP')
    const host = await bal(b.hostId, 'SYP')
    const admin = await bal(b.adminUserId, 'SYP')
    // Admin share credited at approval is reversed at cancel, so the admin nets exactly the fee; the guest
    // holds the rest; the host HOLD is a 0-delta marker. Nothing is minted or burned.
    expect(admin).toBe(FLAT_FEE_SYP)
    expect(guest).toBe(paid - FLAT_FEE_SYP)
    expect(guest + host + admin).toBe(paid)
  })

  it('4. USD booking uses the USD flat fee, withheld from a USD refund — no SYP wallet touched', async () => {
    const paid = 10000
    const b = await setUpBooking({ checkInDaysFromNow: 1, currency: 'USD', priceMinor: paid })
    const res = await cancel(b.bookingId, b.guestToken)
    expect(res.status).toBe(200)

    const adminFee = await db().walletEntry.findFirst({ where: { referenceType: 'booking_guest_cancel_fee', referenceId: b.bookingId, type: 'CREDIT' } })
    expect(adminFee.currency).toBe('USD')
    expect(adminFee.amountMinor).toBe(FLAT_FEE_USD)
    expect(await bal(b.guestId, 'USD')).toBe(paid - FLAT_FEE_USD)
    expect(await bal(b.guestId, 'USD')).toBeGreaterThanOrEqual(0)
    // The guest's default SYP wallet (seeded at registration) is left completely untouched — the old bug
    // moved money in the wrong currency; the fix keeps everything in the booking currency (USD).
    expect(await bal(b.guestId, 'SYP')).toBe(0)
  })

  it('5a. waived (free-window) refunds in full — zero fee', async () => {
    const paid = 100000
    const b = await setUpBooking({ checkInDaysFromNow: 30, currency: 'SYP', priceMinor: paid })
    const res = await cancel(b.bookingId, b.guestToken)
    expect(res.status).toBe(200)

    expect(await db().walletEntry.findFirst({ where: { referenceType: 'booking_guest_cancel_fee', referenceId: b.bookingId } })).toBeNull()
    expect(await bal(b.guestId, 'SYP')).toBe(paid) // refunded in full
  })

  it('5b. waived (protection add-on) refunds in full minus the non-refundable premium — zero cancel fee', async () => {
    const paid = 100000
    const protectionFeeMinor = 1000
    const b = await setUpBooking({
      checkInDaysFromNow: 1, currency: 'SYP', priceMinor: paid,
      metadata: { cancellationProtectionPurchased: true, cancellationProtectionFeeMinor: protectionFeeMinor },
    })
    const res = await cancel(b.bookingId, b.guestToken)
    expect(res.status).toBe(200)

    expect(await db().walletEntry.findFirst({ where: { referenceType: 'booking_guest_cancel_fee', referenceId: b.bookingId } })).toBeNull()
    const refund = await db().walletEntry.findFirst({ where: { referenceType: 'booking_refund', referenceId: b.bookingId } })
    expect(refund.amountMinor).toBe(paid - protectionFeeMinor) // protection premium is the only thing withheld
    expect(await bal(b.guestId, 'SYP')).toBe(paid - protectionFeeMinor)
  })
})
