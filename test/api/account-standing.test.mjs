import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { ruleTier } from '../../server/lib/account-standing.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Loyalty / fidelity standing (Phase 2): AI (or the rule fallback) suggests a tier, an admin approves,
// and only then does the user's live tier change — surfaced to guests as a host badge on the listing.

let app
let admin

async function makeUser(role, label, extra = {}) {
  const user = await db().user.create({
    data: { email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode(), ...extra, roles: { create: { role } } },
  })
  trackTestUser(user.id)
  return user
}

beforeAll(async () => {
  app = await testApp()
  admin = await makeUser('ADMIN', 'standing-admin')
})
afterAll(async () => { await cleanupTestUsers() })

const asAdmin = (m, p) => request(app)[m](p).set('authorization', `Bearer ${createSessionToken(admin)}`)

describe('Account standing — rule tiers + AI-suggests → admin-approves', () => {
  it('ruleTier ladders are correct for host and guest', () => {
    expect(ruleTier('HOST', { verifiedId: false })).toBe('NEW')
    expect(ruleTier('HOST', { verifiedId: true, ratingAvg: 0, ratingCount: 0, completedBookings: 0, openTruthWarnings: 0 })).toBe('VERIFIED')
    expect(ruleTier('HOST', { verifiedId: true, ratingAvg: 4.5, ratingCount: 4, completedBookings: 8, openTruthWarnings: 0 })).toBe('TRUSTED')
    expect(ruleTier('HOST', { verifiedId: true, ratingAvg: 4.8, ratingCount: 12, completedBookings: 25, openTruthWarnings: 0 })).toBe('ELITE')
    // An open honesty flag blocks ELITE.
    expect(ruleTier('HOST', { verifiedId: true, ratingAvg: 4.8, ratingCount: 12, completedBookings: 25, openTruthWarnings: 1 })).toBe('TRUSTED')
    expect(ruleTier('GUEST', { completedBookings: 12, disputes: 0 })).toBe('VIP')
    expect(ruleTier('GUEST', { completedBookings: 4, disputes: 0 })).toBe('RELIABLE')
    expect(ruleTier('GUEST', { completedBookings: 12, disputes: 2 })).toBe('NEW')
  })

  it('suggest queues a PENDING change for a verified host, but nothing when the tier is unchanged', async () => {
    const host = await makeUser('HOST', 'standing-verified', { idDocumentStatus: 'APPROVED' })
    const res = await asAdmin('post', '/api/admin/standing/suggest').send({ userId: host.id, kind: 'HOST' })
    expect(res.status).toBe(200)
    expect(res.body.suggestion.suggestedTier).toBe('VERIFIED')
    expect(res.body.suggestion.currentTier).toBe('NEW')
    expect(res.body.suggestion.status).toBe('PENDING')

    // A brand-new guest (no bookings) stays NEW → no suggestion to make.
    const guest = await makeUser('GUEST', 'standing-newguest')
    const none = await asAdmin('post', '/api/admin/standing/suggest').send({ userId: guest.id, kind: 'GUEST' })
    expect(none.status).toBe(200)
    expect(none.body.suggestion).toBeNull()
  })

  it('APPROVE applies the tier + audits; the queue shows pending items', async () => {
    const host = await makeUser('HOST', 'standing-approve', { idDocumentStatus: 'APPROVED' })
    const sug = (await asAdmin('post', '/api/admin/standing/suggest').send({ userId: host.id, kind: 'HOST' })).body.suggestion

    const queue = await asAdmin('get', '/api/admin/standing/suggestions?status=PENDING')
    expect(queue.body.suggestions.some((s) => s.id === sug.id)).toBe(true)

    const decide = await asAdmin('patch', `/api/admin/standing/suggestions/${sug.id}`).send({ decision: 'APPROVE' })
    expect(decide.status).toBe(200)
    expect(decide.body.suggestion.status).toBe('APPROVED')

    const standing = await db().accountStanding.findUnique({ where: { userId_kind: { userId: host.id, kind: 'HOST' } } })
    expect(standing.tier).toBe('VERIFIED')
    const audit = await db().adminAuditLog.findFirst({ where: { entityType: 'standing_suggestions', entityId: sug.id, action: 'STANDING_APPROVED' } })
    expect(audit).not.toBeNull()
  })

  it('REJECT records the decision and does NOT change the live tier', async () => {
    const host = await makeUser('HOST', 'standing-reject', { idDocumentStatus: 'APPROVED' })
    const sug = (await asAdmin('post', '/api/admin/standing/suggest').send({ userId: host.id, kind: 'HOST' })).body.suggestion
    const decide = await asAdmin('patch', `/api/admin/standing/suggestions/${sug.id}`).send({ decision: 'REJECT' })
    expect(decide.status).toBe(200)
    expect(decide.body.suggestion.status).toBe('REJECTED')
    expect(await db().accountStanding.findUnique({ where: { userId_kind: { userId: host.id, kind: 'HOST' } } })).toBeNull()
  })

  it('an approved host tier is exposed on the public listing detail as a guest-facing badge', async () => {
    const host = await makeUser('HOST', 'standing-badge', { idDocumentStatus: 'APPROVED' })
    const sug = (await asAdmin('post', '/api/admin/standing/suggest').send({ userId: host.id, kind: 'HOST' })).body.suggestion
    await asAdmin('patch', `/api/admin/standing/suggestions/${sug.id}`).send({ decision: 'APPROVE' })

    const listing = await db().listing.create({
      data: { ownerId: host.id, division: 'STAYS', titleAr: 'وحدة', titleEn: 'Unit', priceMinor: 100_00, currency: 'USD', status: 'APPROVED' },
    })
    const detail = await request(app).get(`/api/listings/${listing.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.hostTier).toBe('VERIFIED')
  })

  it('the AI capsule falls back to the rule tier when AI is unconfigured (no key in test env)', async () => {
    // With no ANTHROPIC key the suggestion still gets made (rule baseline) — aiModel stays null.
    const host = await makeUser('HOST', 'standing-fallback', { idDocumentStatus: 'APPROVED' })
    const res = await asAdmin('post', '/api/admin/standing/suggest').send({ userId: host.id, kind: 'HOST' })
    expect(res.body.suggestion.suggestedTier).toBe('VERIFIED')
    expect(res.body.suggestion.aiModel).toBeNull()
  })
})
