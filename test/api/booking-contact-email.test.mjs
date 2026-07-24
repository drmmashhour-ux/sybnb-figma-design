import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { NOTIFICATION_AUDIT_ACTION } from '../../server/lib/notifications.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// FIX 2 — the contact-before-payment step now captures the guest's email, persists it as
// metadata.guestContactEmail, and triggers a best-effort "booking request received" confirmation.
// In the test env the mailer is NOT configured, so delivery is SUPPRESSED — which proves the critical
// safety property: confirmationEmailSent is NEVER true unless the provider actually sent.

describe('FIX 2 — booking contact captures + persists guest email (provider-not-ok never marks sent)', () => {
  let app, guestToken, guestId, listingId

  beforeAll(async () => {
    app = testApp()
    const host = await db().user.create({ data: { email: uniqueTestEmail('c-email-host'), displayName: 'H', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } } } })
    trackTestUser(host.id)
    const guest = await db().user.create({ data: { email: uniqueTestEmail('c-email-guest'), displayName: 'G', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', locale: 'en-US', roles: { create: { role: 'GUEST' } } } })
    trackTestUser(guest.id)
    guestId = guest.id
    guestToken = createSessionToken(guest)
    const listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', titleAr: 'ت', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' } })
    listingId = listing.id
  })

  afterAll(async () => { await cleanupTestUsers() })

  async function newBooking() {
    const b = await db().booking.create({ data: { listingId, guestId, status: 'PAYMENT_PENDING', amountMinor: 100_00, currency: 'USD' } })
    return b.id
  }

  it('persists guestContactEmail (+name/phone) and does NOT mark sent when the mailer is unconfigured', async () => {
    const bookingId = await newBooking()
    const email = 'guest.person@example.com'
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/contact`)
      .set('authorization', `Bearer ${guestToken}`)
      .send({ guestName: 'Guest Person', guestPhone: '+963999123456', guestEmail: email })
    expect(res.status).toBe(200)

    const booking = await db().booking.findUnique({ where: { id: bookingId } })
    expect(booking.metadata.guestContactEmail).toBe(email)
    expect(booking.metadata.guestContactName).toBe('Guest Person')
    expect(booking.metadata.guestContactPhone).toBeTruthy()
    // Mailer not configured in tests -> SUPPRESSED -> never "sent".
    expect(booking.metadata.confirmationEmailSent).toBe(false)

    // The request-received confirmation was WIRED (a delivery status was recorded for this booking).
    const delivery = await db().adminAuditLog.findFirst({ where: { action: NOTIFICATION_AUDIT_ACTION, entityId: bookingId }, orderBy: { createdAt: 'desc' } })
    expect(delivery?.after?.event).toBe('BOOKING_SUBMITTED')
  })

  it('rejects an invalid email with 400', async () => {
    const bookingId = await newBooking()
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/contact`)
      .set('authorization', `Bearer ${guestToken}`)
      .send({ guestName: 'Guest Person', guestPhone: '+963999123456', guestEmail: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_INVALID_EMAIL')
  })

  it('tolerates a missing email server-side (client enforces it) and attempts no confirmation', async () => {
    // Backward compatible: older callers with no email still save name/phone; no confirmation is sent.
    const bookingId = await newBooking()
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/contact`)
      .set('authorization', `Bearer ${guestToken}`)
      .send({ guestName: 'Guest Person', guestPhone: '+963999123456' })
    expect(res.status).toBe(200)
    const booking = await db().booking.findUnique({ where: { id: bookingId } })
    expect(booking.metadata.guestContactPhone).toBeTruthy()
    expect(booking.metadata.guestContactEmail).toBeUndefined()
    expect(booking.metadata.confirmationEmailSent).toBeUndefined()
  })

  it('the delivery record never contains the raw email', async () => {
    const bookingId = await newBooking()
    const email = 'private.guest@example.com'
    await request(app).patch(`/api/bookings/${bookingId}/contact`).set('authorization', `Bearer ${guestToken}`).send({ guestName: 'G P', guestPhone: '+963999123456', guestEmail: email })
    const delivery = await db().adminAuditLog.findFirst({ where: { action: NOTIFICATION_AUDIT_ACTION, entityId: bookingId }, orderBy: { createdAt: 'desc' } })
    expect(JSON.stringify(delivery)).not.toContain(email)
  })
})
