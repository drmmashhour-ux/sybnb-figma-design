import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { executeAssistantTool, getBookingStatus } from '../../server/lib/assistant-tools.mjs'
import { proposeAssistantAction, purgeAssistantConfirmations } from '../../server/lib/assistant-confirmations.mjs'
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
    vi.unstubAllGlobals()
    delete process.env.OPENAI_API_KEY
    delete process.env.AI_BOOKING_ASSISTANT_ENABLED
    delete process.env.SYBNB_DEPLOY_ENV
    delete process.env.RATE_LIMIT_ASSISTANT_ASK_MAX
    delete process.env.RATE_LIMIT_ASSISTANT_ASK_WINDOW_MS
    delete process.env.RATE_LIMIT_ASSISTANT_ACTION_MAX
    delete process.env.RATE_LIMIT_ASSISTANT_ACTION_WINDOW_MS
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

  it('returns and audits a localized safe fallback when the provider fails', async () => {
    process.env.OPENAI_API_KEY = 'test-only'
    const failure = new Error('provider secret 4111111111111111'); failure.name = 'AbortError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    const response = await request(app).post('/api/assistant/ask').set('Authorization', `Bearer ${guest.token}`).send({ question: 'Aidez-moi', locale: 'fr' })
    vi.unstubAllGlobals(); delete process.env.OPENAI_API_KEY
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ source: 'template', answer: expect.stringContaining('Je peux') })
    expect(JSON.stringify(response.body)).not.toContain('4111111111111111')
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: guest.user.id, action: 'AI_ASSISTANT_SAFE_FALLBACK' }, orderBy: { createdAt: 'desc' } })
    expect(audit.after).toEqual({ reason: 'PROVIDER_TIMEOUT' })
  })

  it('fails closed for cross-user booking status', async () => {
    await expect(getBookingStatus({ bookingId: booking.id }, { user: { id: otherGuest.user.id } })).rejects.toMatchObject({ code: 'ASSISTANT_BOOKING_UNAVAILABLE' })
    await expect(executeAssistantTool('getBookingStatus', { bookingId: booking.id }, { user: { id: otherGuest.user.id }, roles: ['GUEST'] })).rejects.toMatchObject({ code: 'ASSISTANT_BOOKING_UNAVAILABLE' })
  })

  it('stores only an approved support reason code and rejects sensitive free text', async () => {
    const context = { user: { id: guest.user.id }, roles: ['GUEST'] }
    await expect(executeAssistantTool('createSupportHandoff', { reason: 'Guest me@example.com card 4111111111111111' }, context)).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
    const result = await executeAssistantTool('createSupportHandoff', { reason: 'SENSITIVE_REQUEST' }, context)
    expect(result).toMatchObject({ created: true, reasonCode: 'SENSITIVE_REQUEST' })
    const audit = await db().adminAuditLog.findFirst({ where: { actorUserId: guest.user.id, action: 'AI_ASSISTANT_SUPPORT_HANDOFF' }, orderBy: { createdAt: 'desc' } })
    expect(audit.after).toEqual({ reasonCode: 'SENSITIVE_REQUEST' })
    expect(JSON.stringify(audit)).not.toContain('example.com')
    expect(JSON.stringify(audit)).not.toContain('4111111111111111')
  })

  it('denies consequential proposals to non-guest roles', async () => {
    await expect(proposeAssistantAction({ actorUserId: host.id, roles: ['HOST'], action: 'CREATE_BOOKING_DRAFT', payload: { listingId: listing.id, checkIn: '2026-10-01', checkOut: '2026-10-02', guests: 1 }, locale: 'en' })).rejects.toMatchObject({ code: 'ASSISTANT_GUEST_REQUIRED', statusCode: 403 })
  })

  it('requires a claimed one-time server confirmation for a booking draft', async () => {
    const args = { listingId: listing.id, checkIn: '2026-10-01', checkOut: '2026-10-02', guests: 2 }
    await expect(executeAssistantTool('createBookingDraft', { ...args, amountMinor: 1 }, { user: { id: guest.user.id }, roles: ['GUEST'], confirmationClaimed: true })).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
    await expect(executeAssistantTool('createBookingDraft', args, { user: { id: guest.user.id }, roles: ['GUEST'] })).rejects.toMatchObject({ code: 'ASSISTANT_TOOL_INVALID' })
    const proposed = await request(app).post('/api/assistant/actions/propose').set('Authorization', `Bearer ${guest.token}`).send({ action: 'CREATE_BOOKING_DRAFT', payload: args, locale: 'en' })
    expect(proposed.status).toBe(200)
    expect(proposed.body.proposal.summary).toEqual({ action: 'CREATE_BOOKING_DRAFT', listingId: listing.id, checkIn: '2026-10-01', checkOut: '2026-10-02', guests: 2, available: true, nights: 1, total: { amountMinor: 10_000, currency: 'SYP' } })
    const confirmed = await request(app).post('/api/assistant/actions/confirm').set('Authorization', `Bearer ${guest.token}`).send({ proposalId: proposed.body.proposal.proposalId, payload: args, decision: true, locale: 'en' })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.confirmation.result.draft.total).toEqual({ amountMinor: 10_000, currency: 'SYP' })
    expect(confirmed.body.confirmation.result.notice).toMatch(/No inventory is reserved/)
  })

  it('invalidates changed facts and rejects replay, forged payloads, expiry, and cross-user claims', async () => {
    const payload = { listingId: listing.id, checkIn: '2026-11-01', checkOut: '2026-11-02', guests: 2 }
    const propose = async () => (await request(app).post('/api/assistant/actions/propose').set('Authorization', `Bearer ${guest.token}`).send({ action: 'CREATE_BOOKING_DRAFT', payload, locale: 'fr' })).body.proposal

    const crossUser = await propose()
    expect((await request(app).post('/api/assistant/actions/confirm').set('Authorization', `Bearer ${otherGuest.token}`).send({ proposalId: crossUser.proposalId, payload, decision: true, locale: 'fr' })).status).toBe(409)

    const forged = await propose()
    expect((await request(app).post('/api/assistant/actions/confirm').set('Authorization', `Bearer ${guest.token}`).send({ proposalId: forged.proposalId, payload: { ...payload, guests: 3 }, decision: true, locale: 'fr' })).status).toBe(409)

    const expired = await propose()
    await db().assistantConfirmation.update({ where: { id: expired.proposalId }, data: { expiresAt: new Date(Date.now() - 1_000) } })
    expect((await request(app).post('/api/assistant/actions/confirm').set('Authorization', `Bearer ${guest.token}`).send({ proposalId: expired.proposalId, payload, decision: true, locale: 'ar' })).status).toBe(409)

    const changed = await propose()
    await db().listing.update({ where: { id: listing.id }, data: { priceMinor: 11_000 } })
    const stale = await request(app).post('/api/assistant/actions/confirm').set('Authorization', `Bearer ${guest.token}`).send({ proposalId: changed.proposalId, payload, decision: true, locale: 'ar' })
    expect(stale.status).toBe(409)
    expect(stale.body.error.message).toContain('غير صالح')

    const replay = await propose()
    const first = await request(app).post('/api/assistant/actions/confirm').set('Authorization', `Bearer ${guest.token}`).send({ proposalId: replay.proposalId, payload, decision: true, locale: 'en' })
    const second = await request(app).post('/api/assistant/actions/confirm').set('Authorization', `Bearer ${guest.token}`).send({ proposalId: replay.proposalId, payload, decision: true, locale: 'en' })
    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    await db().listing.update({ where: { id: listing.id }, data: { priceMinor: 10_000 } })
  })

  it('proposes all consequential actions without duplicating existing mutations or logging sensitive text', async () => {
    const cases = [
      ['SEND_MESSAGE', { bookingId: booking.id, message: 'private guest message 4111111111111111' }],
      ['CANCEL_BOOKING', { bookingId: booking.id }],
      ['REQUEST_REFUND', { bookingId: booking.id, reason: 'private refund reason' }],
      ['CHANGE_DATES', { bookingId: booking.id, checkIn: '2026-09-03', checkOut: '2026-09-04' }],
      ['CHANGE_GUEST_COUNT', { bookingId: booking.id, guests: 3 }],
      ['INITIATE_PAYMENT', { bookingId: booking.id }],
    ]
    for (const [action, payload] of cases) {
      const response = await request(app).post('/api/assistant/actions/propose').set('Authorization', `Bearer ${guest.token}`).send({ action, payload, locale: 'en' })
      expect(response.status).toBe(200)
      expect(response.body.proposal.action).toBe(action)
    }
    const rejectedProposal = await request(app).post('/api/assistant/actions/propose').set('Authorization', `Bearer ${guest.token}`).send({ action: 'CANCEL_BOOKING', payload: { bookingId: booking.id }, locale: 'en' })
    const rejected = await request(app).post('/api/assistant/actions/confirm').set('Authorization', `Bearer ${guest.token}`).send({ proposalId: rejectedProposal.body.proposal.proposalId, payload: { bookingId: booking.id }, decision: false, locale: 'en' })
    expect(rejected.body.confirmation).toMatchObject({ accepted: false, executed: false })
    const unchanged = await db().booking.findUnique({ where: { id: booking.id } })
    expect(unchanged.status).toBe('REQUESTED')
    const audits = await db().adminAuditLog.findMany({ where: { actorUserId: guest.user.id, action: { startsWith: 'AI_ASSISTANT_' } } })
    const actions = new Set(audits.map((item) => item.action))
    for (const action of ['AI_ASSISTANT_REQUEST_RECEIVED', 'AI_ASSISTANT_SERVER_FACT_RETRIEVED', 'AI_ASSISTANT_TOOL_PROPOSED', 'AI_ASSISTANT_CONFIRMATION_REQUESTED', 'AI_ASSISTANT_CONFIRMATION_ACCEPTED', 'AI_ASSISTANT_CONFIRMATION_REJECTED', 'AI_ASSISTANT_TOOL_EXECUTED', 'AI_ASSISTANT_ATTEMPT_BLOCKED', 'AI_ASSISTANT_SAFE_FALLBACK']) expect(actions.has(action)).toBe(true)
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toContain('private guest message')
    expect(serialized).not.toContain('4111111111111111')
    expect(serialized).not.toContain('private refund reason')
  })

  it('purges only expired or consumed confirmation records beyond retention', async () => {
    const now = new Date('2026-12-15T12:00:00.000Z')
    const common = { actorUserId: guest.user.id, action: 'CREATE_BOOKING_DRAFT', payloadHash: 'payload-hash', factHash: 'fact-hash', entityType: 'listing', entityId: listing.id }
    const [consumed, expired, recent] = await Promise.all([
      db().assistantConfirmation.create({ data: { ...common, status: 'ACCEPTED', expiresAt: new Date('2026-12-13T10:00:00.000Z'), consumedAt: new Date('2026-12-13T10:00:00.000Z') } }),
      db().assistantConfirmation.create({ data: { ...common, status: 'PENDING', expiresAt: new Date('2026-12-13T10:00:00.000Z') } }),
      db().assistantConfirmation.create({ data: { ...common, status: 'PENDING', expiresAt: new Date('2026-12-15T11:55:00.000Z') } }),
    ])
    expect(await purgeAssistantConfirmations({ now, retentionHours: 24 })).toBeGreaterThanOrEqual(2)
    expect(await db().assistantConfirmation.findUnique({ where: { id: consumed.id } })).toBeNull()
    expect(await db().assistantConfirmation.findUnique({ where: { id: expired.id } })).toBeNull()
    expect(await db().assistantConfirmation.findUnique({ where: { id: recent.id } })).not.toBeNull()
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

  it('rate limits action proposals and confirmations independently', async () => {
    process.env.RATE_LIMIT_STORE = 'db'
    process.env.RATE_LIMIT_ASSISTANT_ACTION_MAX = '2'
    process.env.RATE_LIMIT_ASSISTANT_ACTION_WINDOW_MS = '60000'
    await db().rateLimitHit.deleteMany({ where: { key: { startsWith: 'ASSISTANT_ACTION:' } } })
    const payload = { listingId: listing.id, checkIn: '2026-12-01', checkOut: '2026-12-02', guests: 2 }
    const propose = () => request(app).post('/api/assistant/actions/propose').set('Authorization', `Bearer ${guest.token}`).send({ action: 'CREATE_BOOKING_DRAFT', payload, locale: 'en' })
    expect((await propose()).status).toBe(200)
    expect((await propose()).status).toBe(200)
    expect((await propose()).status).toBe(429)
  })
})
