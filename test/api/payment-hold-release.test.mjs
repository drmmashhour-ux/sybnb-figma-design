import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'
import { releaseAbandonedHolds, adminReleaseHold, HOLD_RELEASE_ACTION } from '../../server/lib/booking-lifecycle.mjs'

// SYB-002 — abandoned payment-hold release. Covers the release service, the admin manual-release route,
// and host read-only visibility. Bookings enter PAYMENT_PENDING and occupy availability; an abandoned
// hold must eventually release its inventory, but a paid booking awaiting review must never be swept.

const DAY = 24 * 60 * 60 * 1000

async function createUser(role, label) {
  const user = await db().user.create({
    data: {
      email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'),
      displayName: `Test ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } },
    },
  })
  trackTestUser(user.id)
  return { token: createSessionToken(user), user }
}

describe('SYB-002 — abandoned payment-hold release', () => {
  let app, host, guest, admin, listing

  beforeAll(async () => {
    app = testApp()
    host = await createUser('HOST', 'ph-host')
    guest = await createUser('GUEST', 'ph-guest')
    admin = await createUser('ADMIN', 'ph-admin')
    listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'حجز معلّق', titleEn: 'Hold Release Test Stay', priceMinor: 50_00, currency: 'USD', status: 'APPROVED' },
    })
  })
  afterAll(async () => { await cleanupTestUsers() })

  async function makeHold({ status = 'PAYMENT_PENDING', ageDays = 3, checkIn = null, proof = null } = {}) {
    const booking = await db().booking.create({
      data: {
        listingId: listing.id, guestId: guest.user.id, status, amountMinor: 50_00, currency: 'USD',
        createdAt: new Date(Date.now() - ageDays * DAY), checkIn,
      },
    })
    if (proof) {
      await db().paymentProof.create({
        data: { bookingId: booking.id, userId: guest.user.id, provider: proof.provider || 'syrian_local_wallet', status: proof.status, amountMinor: 50_00, currency: 'USD' },
      })
    }
    return booking
  }
  const reload = (id) => db().booking.findUnique({ where: { id } })
  const auditFor = (id) => db().adminAuditLog.findFirst({ where: { action: HOLD_RELEASE_ACTION, entityId: id }, orderBy: { createdAt: 'desc' } })

  // ---- release service ----------------------------------------------------------------------------
  it('does NOT release a hold that is not yet expired', async () => {
    const b = await makeHold({ ageDays: 0 }) // unknown method, 24h window
    expect(await releaseAbandonedHolds({ id: b.id })).toBe(0)
    expect((await reload(b.id)).status).toBe('PAYMENT_PENDING')
  })

  it('releases an expired, proof-less hold to CANCELLED with structured metadata + audit', async () => {
    const b = await makeHold({ ageDays: 3 })
    expect(await releaseAbandonedHolds({ id: b.id })).toBe(1)
    const after = await reload(b.id)
    expect(after.status).toBe('CANCELLED')
    expect(after.metadata.release.kind).toBe('AUTO_EXPIRED_HOLD')
    expect(after.metadata.release.priorStatus).toBe('PAYMENT_PENDING')
    expect(after.metadata.release.policyVersion).toBe('hold-policy-v1')
    expect(after.metadata.release.releasedBy).toBe('scheduler')
    const audit = await auditFor(b.id)
    expect(audit).toBeTruthy()
    expect(audit.after.resultingStatus).toBe('CANCELLED')
  })

  it('never releases a hold with a payment proof under review', async () => {
    for (const status of ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED']) {
      const b = await makeHold({ ageDays: 5, proof: { status } })
      expect(await releaseAbandonedHolds({ id: b.id })).toBe(0)
      expect((await reload(b.id)).status).toBe('PAYMENT_PENDING')
    }
  })

  it('never releases confirmed, completed, or already-cancelled bookings', async () => {
    for (const status of ['CONFIRMED', 'COMPLETED', 'CANCELLED']) {
      const b = await makeHold({ ageDays: 5, status })
      expect(await releaseAbandonedHolds({ id: b.id })).toBe(0)
      expect((await reload(b.id)).status).toBe(status)
    }
  })

  it('is idempotent — a second sweep releases nothing more (duplicate execution safe)', async () => {
    const b = await makeHold({ ageDays: 3 })
    expect(await releaseAbandonedHolds({ id: b.id })).toBe(1)
    expect(await releaseAbandonedHolds({ id: b.id })).toBe(0) // already CANCELLED, status guard matches 0
    expect((await reload(b.id)).status).toBe('CANCELLED')
  })

  it('a concurrent transition wins — a hold moved to CONFIRMED between reads is not released', async () => {
    const b = await makeHold({ ageDays: 3 })
    // Simulate another authoritative transition moving it off PAYMENT_PENDING before the sweep claims it.
    await db().booking.update({ where: { id: b.id }, data: { status: 'CONFIRMED' } })
    expect(await releaseAbandonedHolds({ id: b.id })).toBe(0)
    expect((await reload(b.id)).status).toBe('CONFIRMED')
  })

  it('restores inventory — a released hold no longer occupies its dates', async () => {
    const checkIn = new Date(Date.now() + 40 * DAY)
    const checkOut = new Date(Date.now() + 43 * DAY)
    const b = await db().booking.create({
      data: { listingId: listing.id, guestId: guest.user.id, status: 'PAYMENT_PENDING', amountMinor: 50_00, currency: 'USD', createdAt: new Date(Date.now() - 3 * DAY), checkIn, checkOut },
    })
    // Occupying set is REQUESTED/PAYMENT_PENDING/CONFIRMED — the hold occupies now.
    const before = await db().booking.count({ where: { listingId: listing.id, status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] }, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } } })
    expect(before).toBeGreaterThanOrEqual(1)
    await releaseAbandonedHolds({ id: b.id })
    const after = await db().booking.count({ where: { listingId: listing.id, status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] }, checkIn: { lt: checkOut }, checkOut: { gt: checkIn } } })
    expect(after).toBe(before - 1) // the released hold no longer counts as occupying
  })

  it('past-dated check-in is released immediately (fast-path)', async () => {
    const b = await makeHold({ ageDays: 0, checkIn: new Date(Date.now() - 2 * DAY) })
    expect(await releaseAbandonedHolds({ id: b.id })).toBe(1)
  })

  it('is configurable by payment method — a tightened wallet window makes a young hold eligible', async () => {
    const b = await makeHold({ ageDays: 0, proof: { provider: 'syrian_local_wallet', status: 'REJECTED' } })
    expect(await releaseAbandonedHolds({ id: b.id })).toBe(0) // default 60m window
    const prev = process.env.HOLD_EXPIRY_WALLET_MINUTES
    process.env.HOLD_EXPIRY_WALLET_MINUTES = '1'
    // age it to 2 minutes so it exceeds the 1-minute override
    await db().booking.update({ where: { id: b.id }, data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) } })
    try {
      expect(await releaseAbandonedHolds({ id: b.id })).toBe(1)
    } finally {
      if (prev === undefined) delete process.env.HOLD_EXPIRY_WALLET_MINUTES
      else process.env.HOLD_EXPIRY_WALLET_MINUTES = prev
    }
  })

  // ---- admin manual release ----------------------------------------------------------------------
  it('admin can manually release an abandoned hold with a reason', async () => {
    const b = await makeHold({ ageDays: 0 }) // not auto-eligible, but admin can release manually
    const res = await request(app).post(`/api/admin/bookings/${b.id}/release-hold`).set('Authorization', `Bearer ${admin.token}`).send({ reason: 'guest confirmed by phone they abandoned this' })
    expect(res.status).toBe(200)
    const after = await reload(b.id)
    expect(after.status).toBe('CANCELLED')
    expect(after.metadata.release.kind).toBe('ADMIN_RELEASED_ABANDONED_HOLD')
    expect(after.metadata.release.releasedBy).toBe(admin.user.id)
    expect(after.metadata.release.reason).toMatch(/phone/)
  })

  it('admin manual release requires a reason', async () => {
    const b = await makeHold({ ageDays: 0 })
    const res = await request(app).post(`/api/admin/bookings/${b.id}/release-hold`).set('Authorization', `Bearer ${admin.token}`).send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('HOLD_RELEASE_REASON_REQUIRED')
    expect((await reload(b.id)).status).toBe('PAYMENT_PENDING')
  })

  it('admin cannot release a hold that has a proof under review', async () => {
    const b = await makeHold({ ageDays: 5, proof: { status: 'PENDING_ADMIN_REVIEW' } })
    const res = await request(app).post(`/api/admin/bookings/${b.id}/release-hold`).set('Authorization', `Bearer ${admin.token}`).send({ reason: 'trying to release a paid one' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('HOLD_HAS_PROOF_UNDER_REVIEW')
    expect((await reload(b.id)).status).toBe('PAYMENT_PENDING')
  })

  it('a non-staff caller cannot reach the admin release route', async () => {
    const b = await makeHold({ ageDays: 0 })
    const res = await request(app).post(`/api/admin/bookings/${b.id}/release-hold`).set('Authorization', `Bearer ${host.token}`).send({ reason: 'x' })
    expect(res.status).toBe(403)
  })

  // ---- host read-only visibility ------------------------------------------------------------------
  it('host sees PAYMENT_PENDING holds read-only with creation time + expected expiry, and has no release control', async () => {
    await makeHold({ ageDays: 0 }) // a live, not-yet-expired hold so it survives the overview sweep
    const res = await request(app).get('/api/host/overview').set('Authorization', `Bearer ${host.token}`)
    expect(res.status).toBe(200)
    const holds = res.body.overview.requests.filter((r) => r.status === 'PAYMENT_PENDING')
    expect(holds.length).toBeGreaterThanOrEqual(1)
    const h = holds[0]
    expect(h.isPaymentPendingHold).toBe(true)
    expect(h.createdAt).toBeTruthy()
    expect(h.holdExpiresAt).toBeTruthy() // computed, not persisted
    expect(res.body.overview.totals).toHaveProperty('pendingHolds')
    // No host-facing release/approve/cancel field is exposed on the hold, and no host release route exists.
    const stray = await request(app).post(`/api/host/bookings/${h.id}/release-hold`).set('Authorization', `Bearer ${host.token}`).send({ reason: 'x' })
    expect([403, 404, 405].includes(stray.status)).toBe(true)
  })
})
