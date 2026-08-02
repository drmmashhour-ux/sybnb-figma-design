import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { executeAssistantTool, getBookingStatus } from '../../server/lib/assistant-tools.mjs'
import { testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

describe('AI booking assistant authorization and audit', () => {
  const app = testApp()
  let guest
  let otherGuest
  let host
  let listing
  let booking

  beforeAll(async () => {
    process.env.SYBNB_DEPLOY_ENV = 'staging'
    process.env.AI_BOOKING_ASSISTANT_ENABLED = '1'
    delete process.env.OPENAI_API_KEY

    for (const target of ['guest', 'other']) {
      const email = uniqueTestEmail(`assistant-${target}`)
      await verifyEmailForTest(app, email)
      const response = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
      trackTestUser(response.body.user.id)
      if (target === 'guest') guest = response.body
      else otherGuest = response.body
    }
    host = await db().user.create({ data: { email: uniqueTestEmail('assistant-host'), displayName: 'Host', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'HOST' } } }, include: { roles: true } })
    trackTestUser(host.id)
    listing = await db().listing.create({ data: { ownerId: host.id, division: 'STAYS', status: 'APPROVED', titleAr: 'إقامة اختبار', titleEn: 'Test stay', priceMinor: 10_000, currency: 'SYP', metadata: { propertyType: 'apartment', amenities: ['wifi'], houseRules: ['No smoking'] } } })
    booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'REQUESTED', checkIn: new Date('2026-09-01T00:00:00Z'), checkOut: new Date('2026-09-02T00:00:00Z'), amountMinor: 10_000, currency: 'SYP' } })
  })

  afterAll(async () => {
    delete process.env.AI_BOOKING_ASSISTANT_ENABLED
    delete process.env.SYBNB_DEPLOY_ENV
    delete process.env.RATE_LIMIT_ASSISTANT_ASK_MAX
    delete process.env.RATE_LIMIT_ASSISTANT_ASK_WINDOW_MS
    delete process.env.RATE_LIMIT_STORE
  })

  it('requires authentication and validates the request body', async () => {
    expect((await request(app).post('/api/assistant/ask').send({ question: 'Find a stay', locale: 'en' })).status).toBe(401)
    const invalid = await request(app).post('/api/assistant/ask').set('Authorization', `Bearer ${guest.token}`).send({ question: 'Find a stay', rawSql: 'select *' })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('ASSISTANT_REQUEST_INVALID')
  })

  it('supports French and writes a privacy-minimized request audit event', async () => {
    const response = await request(app).post('/api/assistant/ask').set('Authorization', `Bearer ${guest.token}`).send({ question: 'Je cherche un séjour', locale: 'fr', history: [] })
    expect(response.status).toBe(200)
    expect(response.body.answer).toContain('Je peux')
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: guest.user.id, action: 'AI_ASSISTANT_REQUEST_COMPLETED' }, orderBy: { createdAt: 'desc' } })
    expect(audit.after).toMatchObject({ locale: 'fr', source: 'template' })
    expect(JSON.stringify(audit)).not.toContain('Je cherche')
  })

  it('fails closed for cross-user booking status', async () => {
    await expect(getBookingStatus({ bookingId: booking.id }, { user: { id: otherGuest.user.id } })).rejects.toMatchObject({ code: 'ASSISTANT_BOOKING_UNAVAILABLE' })
    await expect(executeAssistantTool('getBookingStatus', { bookingId: booking.id }, { user: { id: otherGuest.user.id }, roles: ['GUEST'] })).rejects.toMatchObject({ code: 'ASSISTANT_BOOKING_UNAVAILABLE' })
  })

  it('requires a server-verified confirmation for a booking draft', async () => {
    const args = { listingId: listing.id, checkIn: '2026-10-01', checkOut: '2026-10-02', guests: 2 }
    await expect(executeAssistantTool('createBookingDraft', { ...args, amountMinor: 1 }, { user: { id: guest.user.id }, roles: ['GUEST'], confirmedDraftListingId: listing.id })).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
    await expect(executeAssistantTool('createBookingDraft', args, { user: { id: guest.user.id }, roles: ['GUEST'] })).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
    const result = await executeAssistantTool('createBookingDraft', args, { user: { id: guest.user.id }, roles: ['GUEST'], confirmedDraftListingId: listing.id })
    expect(result.draft.total).toEqual({ amountMinor: 10_000, currency: 'SYP' })
    expect(result.draft.confirmationRequired).toBe(true)
    expect(result.notice).toMatch(/No inventory is reserved/)
  })

  it('enforces the existing per-user assistant rate limit', async () => {
    process.env.RATE_LIMIT_STORE = 'db'
    process.env.RATE_LIMIT_ASSISTANT_ASK_MAX = '2'
    process.env.RATE_LIMIT_ASSISTANT_ASK_WINDOW_MS = '60000'
    await db().rateLimitHit.deleteMany({ where: { key: { startsWith: 'ASSISTANT_ASK:' } } })
    const ask = () => request(app).post('/api/assistant/ask').set('Authorization', `Bearer ${otherGuest.token}`).send({ question: 'Find a stay', locale: 'en' })
    expect((await ask()).status).toBe(200)
    expect((await ask()).status).toBe(200)
    expect((await ask()).status).toBe(429)
  })
})
