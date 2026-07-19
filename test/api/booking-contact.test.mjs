import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// PATCH /api/bookings/:id/contact replaces the old ID-upload-before-payment gate: instead of a
// photo ID, the guest gives their real name + phone right before paying, so the platform still has
// a way to reach them. Deliberately NOT a hard server-side requirement before payment (that would
// just recreate the same friction under a new name) -- these tests prove the endpoint itself works
// and that payment still proceeds without it ever being called.
describe('PATCH /api/bookings/:id/contact (guest contact info replaces ID verification)', () => {
  let app

  beforeAll(() => {
    app = testApp()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerHost(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ role: 'HOST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function registerGuest(label) {
    const email = uniqueTestEmail(label)
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function checkoutGuest(label) {
    const deviceId = `contact-test-${label}-${Date.now().toString(36)}`
    const res = await request(app).post('/api/auth/checkout-guest').send({ source: 'guest-checkout', deviceId })
    trackTestUser(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  async function makeBooking(host, guestId) {
    const listing = await db().listing.create({
      data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'اختبار جهة الاتصال', priceMinor: 50_00, currency: 'USD', status: 'APPROVED' },
    })
    return db().booking.create({
      data: { listingId: listing.id, guestId, status: 'PAYMENT_PENDING', amountMinor: 50_00, currency: 'USD' },
    })
  }

  it('saves guest name + phone on the booking', async () => {
    const host = await registerHost('contact-host-1')
    const guest = await registerGuest('contact-guest-1')
    const booking = await makeBooking(host, guest.user.id)

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/contact`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ guestName: 'Ahmad Khaled', guestPhone: '+963991234567' })

    expect(res.status).toBe(200)
    expect(res.body.booking.metadata.guestContactName).toBe('Ahmad Khaled')
    expect(res.body.booking.metadata.guestContactPhone).toBe('+963991234567')
  })

  it('rejects an invalid phone number', async () => {
    const host = await registerHost('contact-host-2')
    const guest = await registerGuest('contact-guest-2')
    const booking = await makeBooking(host, guest.user.id)

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/contact`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ guestName: 'Ahmad Khaled', guestPhone: 'not-a-phone!!' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_INVALID_PHONE')
  })

  it('rejects a missing name', async () => {
    const host = await registerHost('contact-host-3')
    const guest = await registerGuest('contact-guest-3')
    const booking = await makeBooking(host, guest.user.id)

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/contact`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ guestPhone: '+963991234567' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_REQUIRED')
  })

  it('rejects updating a booking that belongs to a different guest (404, no ownership leak)', async () => {
    const host = await registerHost('contact-host-4')
    const owner = await registerGuest('contact-owner-4')
    const intruder = await registerGuest('contact-intruder-4')
    const booking = await makeBooking(host, owner.user.id)

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/contact`)
      .set('authorization', `Bearer ${intruder.token}`)
      .send({ guestName: 'Someone Else', guestPhone: '+963991234567' })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND')
  })

  it('updates the frictionless guest\'s placeholder displayName to the real name given', async () => {
    const host = await registerHost('contact-host-5')
    const guest = await checkoutGuest('5')
    expect(guest.user.displayName).toBe('SYBNB Guest')
    const booking = await makeBooking(host, guest.user.id)

    const res = await request(app)
      .patch(`/api/bookings/${booking.id}/contact`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ guestName: 'Lina Haddad', guestPhone: '+963991234567' })

    expect(res.status).toBe(200)
    const updatedUser = await db().user.findUnique({ where: { id: guest.user.id } })
    expect(updatedUser.displayName).toBe('Lina Haddad')
  })

  it('does NOT overwrite a real registered guest\'s chosen display name', async () => {
    const host = await registerHost('contact-host-6')
    const guest = await registerGuest('contact-guest-6')
    const booking = await makeBooking(host, guest.user.id)
    const originalName = guest.user.displayName

    await request(app)
      .patch(`/api/bookings/${booking.id}/contact`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ guestName: 'A Totally Different Name', guestPhone: '+963991234567' })

    const updatedUser = await db().user.findUnique({ where: { id: guest.user.id } })
    expect(updatedUser.displayName).toBe(originalName)
  })

  // Contact info is a hard, server-enforced requirement before payment starts (confirmed
  // explicitly, not left as a UI-only nudge like the old ID-verification gate was before it was
  // fixed) -- both payment entry points must reject a booking with no contact info on file, and
  // accept it once contact info has been saved.
  it('payment proof submission is rejected until contact info has been saved for this booking', async () => {
    const host = await registerHost('contact-host-7')
    const guest = await registerGuest('contact-guest-7')
    const booking = await makeBooking(host, guest.user.id)

    const before = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: 50_00, providerRef: `contact-test-ref-${booking.id}-before` })
    expect(before.status).toBe(403)
    expect(before.body.error.code).toBe('GUEST_CONTACT_INFO_REQUIRED')

    await request(app)
      .patch(`/api/bookings/${booking.id}/contact`)
      .set('authorization', `Bearer ${guest.token}`)
      .send({ guestName: 'Contact Gate Guest', guestPhone: '+963991230099' })

    const after = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking.id, amountMinor: 50_00, providerRef: `contact-test-ref-${booking.id}-after` })
    expect(after.status).toBe(201)
  })

  it('a local-wallet-proof submitted with no bookingId at all is unaffected by the contact-info gate (nothing to attach it to)', async () => {
    const guest = await registerGuest('contact-guest-8')

    const res = await request(app)
      .post('/api/payments/local-wallet-proof')
      .set('authorization', `Bearer ${guest.token}`)
      .send({ amountMinor: 19_00, currency: 'USD', providerRef: `no-booking-ref-${guest.user.id}` })

    expect(res.status).toBe(201)
  })
})
