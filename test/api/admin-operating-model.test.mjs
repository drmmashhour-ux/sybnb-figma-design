import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { finalizeStripeSession } from '../../server/routes/payments.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

let app

beforeAll(async () => {
  app = await testApp()
})

afterAll(async () => {
  await cleanupTestUsers()
})

async function createUser(role, label, extra = {}) {
  const user = await db().user.create({
    data: {
      email: uniqueTestEmail(label),
      displayName: label,
      referralCode: uniqueTestReferralCode(),
      ...extra,
      roles: { create: { role } },
    },
  })
  trackTestUser(user.id)
  return { user, token: createSessionToken(user) }
}

async function createListing(ownerId, label, metadata = {}) {
  return db().listing.create({
    data: {
      ownerId,
      titleAr: `إقامة ${label}`,
      titleEn: `Stay ${label}`,
      division: 'STAYS',
      description: 'Listing for admin operating model tests.',
      priceMinor: 100000,
      currency: 'SYP',
      status: 'APPROVED',
      metadata,
    },
  })
}

async function createBooking({ guestId, listingId, status = 'COMPLETED', amountMinor = 100000 }) {
  const checkIn = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000)
  const checkOut = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
  const booking = await db().booking.create({
    data: {
      guestId,
      listingId,
      checkIn,
      checkOut,
      amountMinor,
      currency: 'SYP',
      status,
    },
  })

  if (status !== 'REQUESTED' && status !== 'PAYMENT_PENDING') {
    await db().paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: guestId,
        provider: 'sham_cash',
        status: 'APPROVED',
        amountMinor,
        currency: 'SYP',
        providerRef: `proof-${booking.id}`,
      },
    })
  }

  return booking
}

describe('Admin operating model money safeguards', () => {
  it('keeps admin commission out of host earnings while preserving host payout totals', async () => {
    const host = await createUser('HOST', 'host-earnings-safe')
    const guest = await createUser('GUEST', 'guest-earnings-safe')
    const listing = await createListing(host.user.id, 'earnings-safe')
    const booking = await createBooking({ guestId: guest.user.id, listingId: listing.id })

    const res = await request(app)
      .get('/api/host/earnings')
      .set('authorization', `Bearer ${host.token}`)
      .expect(200)

    const row = res.body.earnings.rows.find((item) => item.bookingId === booking.id)
    expect(row).toBeTruthy()
    expect(row.hostGrossMinor).toBeGreaterThan(0)
    expect(row).not.toHaveProperty('adminCommissionMinor')
    expect(JSON.stringify(res.body)).not.toContain('adminCommissionMinor')
  })

  it('shows payout method only to admin payout reminders', async () => {
    const admin = await createUser('ADMIN', 'admin-payout-method')
    const host = await createUser('HOST', 'host-payout-method', {
      payoutMethod: { type: 'sham_cash', phone: '+963998191422', receiverName: 'SYBNB payout receiver' },
    })
    const guest = await createUser('GUEST', 'guest-payout-method')
    const listing = await createListing(host.user.id, 'payout-method')
    const booking = await createBooking({ guestId: guest.user.id, listingId: listing.id })

    const res = await request(app)
      .get('/api/admin/payouts')
      .set('authorization', `Bearer ${admin.token}`)
      .expect(200)

    const payout = res.body.payouts.find((item) => item.bookingId === booking.id)
    expect(payout).toBeTruthy()
    expect(payout.hostPayoutMethod).toEqual({
      type: 'sham_cash',
      phone: '+963998191422',
      receiverName: 'SYBNB payout receiver',
    })
  })

  it('re-checks payout eligibility inside the release transaction', async () => {
    const sourcePath = fileURLToPath(new URL('../../server/routes/admin.mjs', import.meta.url))
    const source = readFileSync(sourcePath, 'utf8')
    expect(source).toContain('tx.booking.updateMany')
    expect(source).toContain("where: { id: booking.id, status: 'COMPLETED' }")
    expect(source).toContain('if (!freshBooking || !isPayoutEligible(freshBooking)) throw payoutNotEligibleError()')
  })

  it('writes an audit row when Stripe auto-approves a payment', async () => {
    const admin = await createUser('ADMIN', 'admin-stripe-audit')
    const host = await createUser('HOST', 'host-stripe-audit')
    const guest = await createUser('GUEST', 'guest-stripe-audit')
    const listing = await createListing(host.user.id, 'stripe-audit', {
      cleaningFeeMinor: 0,
      taxesMinor: 0,
      extraFeesMinor: 0,
    })
    const booking = await createBooking({
      guestId: guest.user.id,
      listingId: listing.id,
      status: 'PAYMENT_PENDING',
      amountMinor: 100000,
    })

    const proof = await finalizeStripeSession({
      id: `cs_test_${booking.id}`,
      payment_status: 'paid',
      payment_intent: `pi_test_${booking.id}`,
      metadata: { bookingId: booking.id, sypTotalMinor: String(booking.amountMinor) },
    })

    expect(proof.status).toBe('APPROVED')
    const audit = await db().adminAuditLog.findFirst({
      where: { action: 'STRIPE_PAYMENT_AUTO_APPROVED', entityId: proof.id },
    })
    expect(audit).toBeTruthy()
    expect(audit.actorUserId).toBeTruthy()
    expect(audit.after).toMatchObject({
      status: 'APPROVED',
      bookingId: booking.id,
      stripeSessionId: `cs_test_${booking.id}`,
    })
  })
})
