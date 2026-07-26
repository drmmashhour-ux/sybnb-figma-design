import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, seedMatchedReconciliation, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'
import { PAYOUT_AUDIT_ACTIONS } from '../../server/lib/host-payout.mjs'

// SYB-011 — governed manual host payout support: registration (write path + masked read) and the
// staff disbursement-lifecycle recording. No external money rail; the internal ledger stays authoritative.

async function createUser(role, label) {
  const user = await db().user.create({
    data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `Test ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } },
  })
  trackTestUser(user.id)
  return { token: createSessionToken(user), user }
}

describe('SYB-011 — host payout registration', () => {
  let app, host
  beforeAll(async () => { app = testApp(); host = await createUser('HOST', 'payout-host') })
  afterAll(async () => { await cleanupTestUsers() })

  it('registers a payout destination and echoes it MASKED (never the raw phone)', async () => {
    const res = await request(app).patch('/api/me/payout-method').set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'sham_cash', receiverName: 'Layla', phone: '0999123456' })
    expect(res.status).toBe(200)
    expect(res.body.payoutMethod.type).toBe('sham_cash')
    expect(res.body.payoutMethod.receiverName).toBe('Layla')
    expect(res.body.payoutMethod.phone).toMatch(/^••••/)
    expect(JSON.stringify(res.body)).not.toContain('0999123456')

    // Stored in User.payoutMethod (unmasked internally, surfaced only to admin reminders).
    const row = await db().user.findUnique({ where: { id: host.user.id }, select: { payoutMethod: true } })
    expect(row.payoutMethod.phone).toBe('0999123456')
  })

  it('GET returns the masked method', async () => {
    const res = await request(app).get('/api/me/payout-method').set('Authorization', `Bearer ${host.token}`)
    expect(res.status).toBe(200)
    expect(res.body.payoutMethod.phone).toMatch(/^••••/)
  })

  it('rejects an unsupported method type', async () => {
    const res = await request(app).patch('/api/me/payout-method').set('Authorization', `Bearer ${host.token}`).send({ type: 'paypal', receiverName: 'x', phone: 'y' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYOUT_METHOD_TYPE_INVALID')
  })

  it('requires authentication', async () => {
    const res = await request(app).patch('/api/me/payout-method').send({ type: 'sham_cash', receiverName: 'x', phone: 'y' })
    expect(res.status).toBe(401)
  })
})

describe('SYB-011 — admin disbursement lifecycle recording', () => {
  let app, host, admin, releaser, guest, listing, booking
  beforeAll(async () => {
    app = testApp()
    admin = await createUser('ADMIN', 'payout-admin')
    releaser = await createUser('ADMIN', 'payout-releaser') // D2.1: a distinct admin on record so disburse has provenance
    host = await createUser('HOST', 'payout-host2')
    guest = await createUser('GUEST', 'payout-guest')
    await db().user.update({ where: { id: host.user.id }, data: { payoutMethod: { type: 'sham_cash', receiverName: 'Omar', phone: '0988', version: 1 } } })
    listing = await db().listing.create({ data: { ownerId: host.user.id, division: 'STAYS', titleAr: 'دفعة', titleEn: 'Payout Test Stay', priceMinor: 50_00, currency: 'USD', status: 'APPROVED' } })
    booking = await db().booking.create({ data: { listingId: listing.id, guestId: guest.user.id, status: 'COMPLETED', amountMinor: 50_00, currency: 'USD' } })
    // D1: disburse now reads the FROZEN destination snapshot on the payout, never the live host method.
    // Freeze sham_cash here so these lifecycle tests exercise disbursement (not the missing-destination guard).
    await db().payout.create({ data: { bookingId: booking.id, hostId: host.user.id, amountMinor: 50_00, currency: 'USD', status: 'PENDING_HOLD', releasedById: releaser.user.id, destinationSnapshot: { type: 'sham_cash', receiverName: 'Omar', phone: '0988', version: 1 } } })
    // Fix E: disburse requires a MATCHED received-funds record; reconciler (releaser) is distinct from the disbursing admin.
    await seedMatchedReconciliation({ bookingId: booking.id, matchedById: releaser.user.id, grossMinor: 50_00 })
  })
  afterAll(async () => { await cleanupTestUsers() })

  const auditFor = (action, id) => db().adminAuditLog.findFirst({ where: { action, entityId: id }, orderBy: { createdAt: 'desc' } })

  it('records an INITIATED transition with the governed fields', async () => {
    const res = await request(app).post(`/api/admin/payouts/${booking.id}/disburse`).set('Authorization', `Bearer ${admin.token}`)
      .send({ transition: 'INITIATED', reason: 'sending sham cash now' })
    expect(res.status).toBe(201)
    const audit = await auditFor(PAYOUT_AUDIT_ACTIONS.INITIATED, booking.id)
    expect(audit).toBeTruthy()
    expect(audit.actorUserId).toBe(admin.user.id)
    expect(audit.after.method).toBe('sham_cash') // TYPE only, not the raw destination
    expect(audit.after.policyVersion).toBe('host-payout-v1')
    // Never the raw phone/account in the audit payload.
    expect(JSON.stringify(audit)).not.toContain('0988')
  })

  it('COMPLETED requires a payout reference (cannot claim paid without evidence)', async () => {
    const res = await request(app).post(`/api/admin/payouts/${booking.id}/disburse`).set('Authorization', `Bearer ${admin.token}`)
      .send({ transition: 'COMPLETED', reason: 'done' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYOUT_REFERENCE_REQUIRED')
  })

  it('records COMPLETED with reference + reconciliation note', async () => {
    const res = await request(app).post(`/api/admin/payouts/${booking.id}/disburse`).set('Authorization', `Bearer ${admin.token}`)
      .send({ transition: 'COMPLETED', reference: 'SHAM-TX-99887', reason: 'paid', reconciliationNote: 'matched ledger release' })
    expect(res.status).toBe(201)
    const audit = await auditFor(PAYOUT_AUDIT_ACTIONS.COMPLETED, booking.id)
    expect(audit.after.reference).toBe('SHAM-TX-99887')
    expect(audit.after.reconciliationNote).toBe('matched ledger release')
  })

  it('a transition requires a reason', async () => {
    const res = await request(app).post(`/api/admin/payouts/${booking.id}/disburse`).set('Authorization', `Bearer ${admin.token}`).send({ transition: 'FAILED' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('PAYOUT_REASON_REQUIRED')
  })

  it('a non-admin cannot record a disbursement', async () => {
    const res = await request(app).post(`/api/admin/payouts/${booking.id}/disburse`).set('Authorization', `Bearer ${host.token}`).send({ transition: 'INITIATED', reason: 'x' })
    expect(res.status).toBe(403)
  })
})
