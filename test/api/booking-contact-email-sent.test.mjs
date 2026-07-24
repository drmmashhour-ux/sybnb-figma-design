import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// FIX 2 — the "sent" path. With a configured, succeeding provider (mocked), the request-received
// confirmation actually sends: booking.metadata.confirmationEmailSent becomes true and the email body
// carries the /#/track?ref=<confirmation> link. A provider failure must NOT mark it sent.

const outbox = vi.hoisted(() => ({ sent: [], mode: 'ok' }))
vi.mock('../../server/lib/mailer.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    isMailerConfigured: () => true,
    sendTransactionalEmail: async (message) => {
      if (outbox.mode === 'fail') throw new Error('provider down')
      outbox.sent.push(message)
    },
  }
})

const { db } = await import('../../server/lib/prisma.mjs')
const { createSessionToken } = await import('../../server/lib/security.mjs')
const { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } = await import('../support/testServer.mjs')

describe('FIX 2 — confirmation email sends only when the provider succeeds', () => {
  let app, guestToken, guestId, listingId

  beforeAll(async () => {
    app = testApp()
    const host = await db().user.create({ data: { email: uniqueTestEmail('sent-host'), displayName: 'H', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } } } })
    trackTestUser(host.id)
    const guest = await db().user.create({ data: { email: uniqueTestEmail('sent-guest'), displayName: 'G', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', locale: 'en-US', roles: { create: { role: 'GUEST' } } } })
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

  it('marks confirmationEmailSent=true and includes a track link when the provider sends', async () => {
    outbox.mode = 'ok'
    outbox.sent.length = 0
    const bookingId = await newBooking()
    const res = await request(app).patch(`/api/bookings/${bookingId}/contact`).set('authorization', `Bearer ${guestToken}`).send({ guestName: 'G P', guestPhone: '+963999123456', guestEmail: 'ok.guest@example.com' })
    expect(res.status).toBe(200)

    const booking = await db().booking.findUnique({ where: { id: bookingId } })
    expect(booking.metadata.confirmationEmailSent).toBe(true)

    expect(outbox.sent.length).toBe(1)
    expect(outbox.sent[0].to).toBe('ok.guest@example.com')
    expect(outbox.sent[0].text).toMatch(/\/#\/track\?ref=/)
  })

  it('does NOT mark sent when the provider fails', async () => {
    outbox.mode = 'fail'
    const bookingId = await newBooking()
    const res = await request(app).patch(`/api/bookings/${bookingId}/contact`).set('authorization', `Bearer ${guestToken}`).send({ guestName: 'G P', guestPhone: '+963999123456', guestEmail: 'fail.guest@example.com' })
    expect(res.status).toBe(200) // workflow never blocked by a mailer failure
    const booking = await db().booking.findUnique({ where: { id: bookingId } })
    expect(booking.metadata.confirmationEmailSent).toBe(false)
  })
})
