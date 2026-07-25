import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// A6.1 — the commission-consent capture at listing publish must write an immutable, append-only audit row
// carrying actor + timestamp + contractVersion + rate. The rate is the RESOLVED commission rate for the
// listing's jurisdiction (resolveStrCommissionRate), NOT a hardcoded default — so a jurisdiction with a
// non-13% JurisdictionCommissionPolicy logs its own rate (the multi-country lock).

const CONTRACT = 'str-host-commission-v3-card-fee'
// A distinct jurisdiction that will carry a non-default STAY commission policy for this test only.
const XP = 'XP'
const XP_RATE_PARTS = 180_000 // 18% in parts-per-million (1% = 10,000 parts)
const XP_RATE = 0.18
const bearer = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })

describe('A6.1 — commission-consent capture audits the RESOLVED rate (actor + timestamp + version + rate)', () => {
  let app
  const accIds = []
  let xpPolicyId

  // Create a host, a STAYS accommodation in `country`, one room type, then submit with the 13% consent.
  // Returns the `after` payload of the HOST_CONTRACT_ACCEPTED audit row written by that publish.
  async function publishInCountryAndReadConsentAudit(country) {
    const u = await db().user.create({
      data: { email: uniqueTestEmail(`a61-${country.toLowerCase()}-host`), passwordHash: hashPassword('correct-horse-battery'), displayName: 'A6.1 Host', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'HOST' } }, phoneHash: `a61-${Math.random().toString(36).slice(2)}` },
    })
    trackTestUser(u.id)
    const token = createSessionToken(u)

    const acc = await request(app).post('/api/accommodations').set(bearer(token)).send({ titleAr: 'شقة A6', governorate: 'damascus', city: 'damascus', area: 'mazzeh', metadata: { country } })
    const accId = acc.body.accommodation.id
    accIds.push(accId)
    await request(app).post(`/api/accommodations/${accId}/room-types`).set(bearer(token)).send({ titleAr: 'غرفة', priceMinor: 100_00, currency: 'USD', metadata: { country } })

    const submit = await request(app).patch(`/api/accommodations/${accId}/submit`).set(bearer(token)).send({ acceptContract: true, contractVersion: CONTRACT })
    expect(submit.status, `submit in ${country}`).toBe(200)

    const row = await db().adminAuditLog.findFirst({
      where: { entityType: 'host_contract', entityId: accId, action: 'HOST_CONTRACT_ACCEPTED', actorUserId: u.id },
      orderBy: { createdAt: 'desc' },
    })
    return { row, userId: u.id }
  }

  beforeAll(async () => {
    app = testApp()
    // A non-default STAY commission policy for the XP jurisdiction — proves the audit records the RESOLVED
    // rate, not the static 0.13 default.
    const policy = await db().jurisdictionCommissionPolicy.create({
      data: { country: XP, province: null, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: XP_RATE_PARTS, effectiveFrom: new Date('2020-01-01T00:00:00Z'), effectiveTo: null, active: true, note: 'A6.1 test policy' },
    })
    xpPolicyId = policy.id
  })
  afterAll(async () => {
    if (accIds.length) await db().listing.deleteMany({ where: { accommodationId: { in: accIds } } }).catch(() => {})
    if (accIds.length) await db().accommodation.deleteMany({ where: { id: { in: accIds } } }).catch(() => {})
    if (xpPolicyId) await db().jurisdictionCommissionPolicy.delete({ where: { id: xpPolicyId } }).catch(() => {})
    await cleanupTestUsers()
  })

  it('writes actor + timestamp + version + rate, and the Syria (default) path still logs 0.13', async () => {
    const { row, userId } = await publishInCountryAndReadConsentAudit('SY')
    expect(row, 'consent audit row exists').toBeTruthy()
    expect(row.actorUserId, 'actor is the host').toBe(userId)
    expect(row.createdAt instanceof Date, 'has a timestamp').toBe(true)
    expect(row.after?.version, 'records the contract version').toBe(CONTRACT)
    expect(row.after?.rate, 'Syria default path logs the 13% rate').toBe(0.13)
  })

  it('multi-country lock: a jurisdiction with a non-default STAY policy logs THAT resolved rate, not 0.13', async () => {
    const { row } = await publishInCountryAndReadConsentAudit(XP)
    expect(row, 'consent audit row exists').toBeTruthy()
    expect(row.after?.rate, `XP jurisdiction logs its resolved ${XP_RATE} rate`).toBe(XP_RATE)
    expect(row.after?.rate, 'and NOT the hardcoded 0.13 default').not.toBe(0.13)
  })
})
