import request from 'supertest'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { findAuditMutationPaths } from '../conformance/contract.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A6.3 — (1) lock the config/rate-change audit the survey found (tax rates + commission policies each
// write CREATED/UPDATED audit rows with before/after), and (2) assert the append-only immutability
// property of the whole audit log (no update/delete/upsert path anywhere in server/ — .create only).

// Unique test jurisdiction per run so nothing collides with real or other-test jurisdictions.
const CC = `ZZ${String(Date.now()).slice(-6)}`
const bearer = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

describe('A6.3 — config/rate-change audit + append-only immutability', () => {
  let app
  let admin
  const rateIds = []
  const policyIds = []

  beforeAll(async () => {
    app = testApp()
    const u = await db().user.create({
      data: { email: uniqueTestEmail('a63-admin'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'A63 Admin', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'ADMIN' } }, phoneHash: `a63-${Math.random().toString(36).slice(2)}` },
    })
    trackTestUser(u.id)
    admin = { token: createSessionToken(u), id: u.id }
  })
  afterAll(async () => {
    await db().adminAuditLog.deleteMany({ where: { entityId: { in: [...rateIds, ...policyIds] } } }).catch(() => {})
    await db().jurisdictionTaxRate.deleteMany({ where: { id: { in: rateIds } } }).catch(() => {})
    await db().jurisdictionCommissionPolicy.deleteMany({ where: { id: { in: policyIds } } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('tax-rate create + update each append an audit row (CREATED before=null; UPDATED with before/after)', async () => {
    const create = await request(app).post('/api/admin/jurisdiction-pricing/tax-rates').set(bearer(admin.token)).send({
      country: CC, serviceType: 'STAY', taxType: 'LODGING', rateParts: 50_000, calculationBase: 'ACCOMMODATION_ONLY', collectorType: 'PLATFORM', effectiveFrom: '2020-01-01', active: false,
    })
    expect(create.status).toBe(200)
    const rateId = create.body.rate.id
    rateIds.push(rateId)

    const createRow = await db().adminAuditLog.findFirst({ where: { entityType: 'jurisdiction_tax_rates', entityId: rateId, action: 'JURISDICTION_TAX_RATE_CREATED' } })
    expect(createRow, 'CREATED audit row appended').toBeTruthy()
    expect(createRow.actorUserId, 'actor is the admin').toBe(admin.id)
    expect(createRow.before, 'create has no before').toBeNull()
    expect(createRow.after?.rateParts, 'after captures the new rate').toBe(50_000)

    const update = await request(app).patch(`/api/admin/jurisdiction-pricing/tax-rates/${rateId}`).set(bearer(admin.token)).send({ rateParts: 75_000 })
    expect(update.status).toBe(200)
    const updateRow = await db().adminAuditLog.findFirst({ where: { entityType: 'jurisdiction_tax_rates', entityId: rateId, action: 'JURISDICTION_TAX_RATE_UPDATED' }, orderBy: { createdAt: 'desc' } })
    expect(updateRow, 'UPDATED audit row appended').toBeTruthy()
    expect(updateRow.before?.rateParts, 'before = old rate').toBe(50_000)
    expect(updateRow.after?.rateParts, 'after = new rate').toBe(75_000)
  })

  it('commission-policy create + update each append an audit row (CREATED before=null; UPDATED with before/after)', async () => {
    const create = await request(app).post('/api/admin/jurisdiction-pricing/commission-policies').set(bearer(admin.token)).send({
      country: CC, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: 170_000, effectiveFrom: '2020-01-01', active: false,
    })
    expect(create.status).toBe(200)
    const policyId = create.body.policy.id
    policyIds.push(policyId)

    const createRow = await db().adminAuditLog.findFirst({ where: { entityType: 'jurisdiction_commission_policies', entityId: policyId, action: 'JURISDICTION_COMMISSION_POLICY_CREATED' } })
    expect(createRow, 'CREATED audit row appended').toBeTruthy()
    expect(createRow.before, 'create has no before').toBeNull()
    expect(createRow.after?.flatRateParts, 'after captures the new rate').toBe(170_000)

    const update = await request(app).patch(`/api/admin/jurisdiction-pricing/commission-policies/${policyId}`).set(bearer(admin.token)).send({ flatRateParts: 190_000 })
    expect(update.status).toBe(200)
    const updateRow = await db().adminAuditLog.findFirst({ where: { entityType: 'jurisdiction_commission_policies', entityId: policyId, action: 'JURISDICTION_COMMISSION_POLICY_UPDATED' }, orderBy: { createdAt: 'desc' } })
    expect(updateRow, 'UPDATED audit row appended').toBeTruthy()
    expect(updateRow.before?.flatRateParts, 'before = old rate').toBe(170_000)
    expect(updateRow.after?.flatRateParts, 'after = new rate').toBe(190_000)
  })

  it('append-only immutability: server/ has NO adminAuditLog update/delete/upsert path (.create only)', () => {
    const serverDir = fileURLToPath(new URL('../../server', import.meta.url))
    const offenders = findAuditMutationPaths(serverDir)
    expect(offenders, `audit log must be append-only; mutation paths found: ${JSON.stringify(offenders)}`).toEqual([])
  })
})
