import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Fix F7 — a host self-edits their payoutMethod but no audit row is written (no old->new trail). Money-redirect
// is already blocked by D1's frozen snapshot; this is forensic/insider-detection traceability. On a successful
// change, write ONE append-only PAYOUT_METHOD_CHANGED row: actor + old->new method TYPE + a masked last-3 only,
// NEVER the raw account/phone/name. A validation-reject writes nothing.

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const SHAM = { type: 'sham_cash', receiverName: 'Omar', phone: '0999123456' }
const BANK = { type: 'bank_transfer', receiverName: 'Omar', accountRef: 'IBAN-SY-778899' }

describe('host payoutMethod change audit (F7)', () => {
  let app
  const hostIds = []

  const mkHost = async (label) => {
    const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `F7 ${label}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } }, phoneHash: `f7-${Math.random().toString(36).slice(2)}` } })
    trackTestUser(u.id)
    hostIds.push(u.id)
    return { id: u.id, token: createSessionToken(u) }
  }
  const setMethod = (token, body) => request(app).patch('/api/me/payout-method').set(auth(token)).send(body)
  const changeRows = (hostId) => db().adminAuditLog.findMany({ where: { action: 'PAYOUT_METHOD_CHANGED', entityId: hostId }, orderBy: { createdAt: 'asc' } })

  beforeAll(() => { app = testApp() })
  afterAll(async () => {
    await db().adminAuditLog.deleteMany({ where: { entityId: { in: hostIds } } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('a payoutMethod change writes exactly one PAYOUT_METHOD_CHANGED audit row (actor + old->new type)', async () => {
    const host = await mkHost('f7-basic')
    const res = await setMethod(host.token, SHAM)
    expect(res.status).toBe(200)
    const rows = await changeRows(host.id)
    expect(rows.length, 'exactly one change audit row').toBe(1)
    expect(rows[0].actorUserId).toBe(host.id)
    expect(rows[0].before?.type, 'first-ever set -> old type is null').toBeNull()
    expect(rows[0].after?.type).toBe('sham_cash')
  })

  it('the audit records a masked identifier and NO raw PII (no full phone/account/name)', async () => {
    const host = await mkHost('f7-pii')
    await setMethod(host.token, SHAM)
    const rows = await changeRows(host.id)
    const blob = JSON.stringify(rows)
    expect(rows[0].after?.masked, 'last-3 of the phone, masked').toBe('••••456')
    expect(blob, 'the raw phone must never appear in the audit').not.toContain('0999123456')
    expect(blob, 'the receiver name must never appear in the audit').not.toContain('Omar')
  })

  it('a subsequent change records the prior type as `before` (old->new)', async () => {
    const host = await mkHost('f7-oldnew')
    await setMethod(host.token, SHAM)
    await setMethod(host.token, BANK)
    const rows = await changeRows(host.id)
    expect(rows.length).toBe(2)
    expect(rows[1].before?.type).toBe('sham_cash')
    expect(rows[1].after?.type).toBe('bank_transfer')
    expect(JSON.stringify(rows), 'no raw account ref').not.toContain('IBAN-SY-778899')
  })

  it('a validation-rejected change writes NO audit row and still 400s', async () => {
    const host = await mkHost('f7-reject')
    const res = await setMethod(host.token, { type: 'bogus_wallet', receiverName: 'x' })
    expect(res.status).toBe(400)
    expect((await changeRows(host.id)).length, 'a rejected change is never audited').toBe(0)
  })
})
