import { readFileSync } from 'node:fs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { STR_HOST_CONTRACT_VERSION, HOST_CONTRACT_AUDIT_ACTION } from '../../server/lib/host-consent.mjs'
import { strCommissionRateForBooking } from '../../server/lib/finance-ledger.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// M6 — the host commission/contract consent gate. A STAYS publish (/api/listings/:id/submit and
// /api/accommodations/:id/submit) and a STAYS booking-accept (/api/host/requests/:id → CONFIRMED) are
// HARD-BLOCKED (403) unless the request accepts the CURRENT contract version. On success, user-level
// consent is recorded + audited, and the booking's terms {commissionRate, baseVersion} are frozen onto
// booking.metadata at acceptance (the snapshotted rate == the rate applied to that booking's split).

const ZZ = 'ZZ'

describe('M6 — host commission-contract consent gate', () => {
  let app, host, guest, hostId, cleanupPolicyId
  const created = { syListing: null, zzListing: null, booking: null }

  async function createUser(role, label) {
    const user = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `Test ${role}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role } } } })
    trackTestUser(user.id)
    return { token: createSessionToken(user), user }
  }

  beforeAll(async () => {
    app = testApp()
    host = await createUser('HOST', 'm6-host')
    guest = await createUser('GUEST', 'm6-guest')
    hostId = host.user.id

    created.syListing = (await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'ت', titleEn: 'M6 SY', priceMinor: 100_00, currency: 'USD', status: 'DRAFT', metadata: { country: 'SY' } } })).id

    // Confirm-gate fixture in an isolated jurisdiction with a NON-13% policy so the snapshot rate is meaningful.
    const policy = await db().jurisdictionCommissionPolicy.create({ data: { country: ZZ, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: 200_000, effectiveFrom: new Date('2020-01-01'), active: true, note: 'm6 20% test policy' } })
    cleanupPolicyId = policy.id
    created.zzListing = (await db().listing.create({ data: { ownerId: hostId, division: 'STAYS', titleAr: 'ت', titleEn: 'M6 ZZ', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', metadata: { country: ZZ } } })).id
    created.booking = (await db().booking.create({ data: { listingId: created.zzListing, guestId: guest.user.id, status: 'REQUESTED', amountMinor: 100_00, currency: 'USD' } })).id
  })

  afterAll(async () => {
    await db().booking.deleteMany({ where: { id: created.booking } })
    await db().listing.deleteMany({ where: { id: { in: [created.syListing, created.zzListing].filter(Boolean) } } })
    await db().jurisdictionCommissionPolicy.deleteMany({ where: { id: cleanupPolicyId } })
    await cleanupTestUsers()
  })

  const submit = (body) => request(app).patch(`/api/listings/${created.syListing}/submit`).set('authorization', `Bearer ${host.token}`).send(body)

  it('publish: hard-blocks (403) a STAYS submit with no contract consent', async () => {
    const res = await submit({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('HOST_CONTRACT_CONSENT_REQUIRED')
  })

  it('publish: hard-blocks (403) a stale contractVersion (existing-host re-consent)', async () => {
    const res = await submit({ acceptContract: true, contractVersion: 'str-host-commission-v1-OLD' })
    expect(res.status).toBe(403)
  })

  it('publish: succeeds with current-version consent, records user consent + audit', async () => {
    const res = await submit({ acceptContract: true, contractVersion: STR_HOST_CONTRACT_VERSION })
    expect(res.status).toBe(200)
    expect(res.body.listing.status).toBe('PENDING_REVIEW')
    // User-level consent record IS the append-only audit row (host + version + timestamp).
    const audit = await db().adminAuditLog.findFirst({ where: { action: HOST_CONTRACT_AUDIT_ACTION, actorUserId: hostId }, orderBy: { createdAt: 'desc' } })
    expect(audit?.after?.version).toBe(STR_HOST_CONTRACT_VERSION)
    expect(audit?.after?.acceptedAt).toBeTruthy()
  })

  const confirm = (body) => request(app).patch(`/api/host/requests/${created.booking}`).set('authorization', `Bearer ${host.token}`).send({ decision: 'CONFIRMED', acceptedTerms: true, ...body })

  it('accept: hard-blocks (403) a STAYS confirm with no contract consent', async () => {
    const res = await confirm({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('HOST_CONTRACT_CONSENT_REQUIRED')
  })

  it('accept: succeeds with consent, freezes terms snapshot == the applied split rate (20%), records consent', async () => {
    const res = await confirm({ acceptContract: true, contractVersion: STR_HOST_CONTRACT_VERSION })
    expect(res.status).toBe(200)
    const booking = await db().booking.findUnique({ where: { id: created.booking }, include: { listing: true } })
    expect(booking.status).toBe('CONFIRMED')
    // Terms frozen on the booking.
    expect(booking.metadata.termsSnapshot.baseVersion).toBe(STR_HOST_CONTRACT_VERSION)
    expect(booking.metadata.termsSnapshot.commissionRate).toBeCloseTo(0.20, 10)
    // The snapshotted rate equals the rate that would be applied to this booking's split.
    const appliedRate = await strCommissionRateForBooking(db(), booking)
    expect(booking.metadata.termsSnapshot.commissionRate).toBe(appliedRate)
  })

  it('both publish paths carry the consent gate (source guard on the accommodations path)', () => {
    const accommodations = readFileSync(new URL('../../server/routes/accommodations.mjs', import.meta.url), 'utf8')
    expect(accommodations).toMatch(/assertContractConsentAccepted\(body\)/)
    const listings = readFileSync(new URL('../../server/routes/listings.mjs', import.meta.url), 'utf8')
    expect(listings).toMatch(/assertContractConsentAccepted\(body\)/)
  })
})
