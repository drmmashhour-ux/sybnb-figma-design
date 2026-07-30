import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { approvePaymentProof } from '../../server/lib/finance-ledger.mjs'
import { readPaymentProofFile } from '../../server/lib/payment-proof-storage.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../support/testServer.mjs'

// Sham Cash STR host-plan payment proof: the host uploads a real receipt (stored in the DB, not on the
// ephemeral serverless disk); it creates a PENDING proof the admin verifies + approves, which records
// the plan fee via approvePaymentProof's str_host_plan branch. Card is NOT covered here (auto-verified).

const FAKE_RECEIPT_B64 = Buffer.from('fake-receipt-bytes').toString('base64')

async function createUser(role, label) {
  const user = await db().user.create({
    data: { email: uniqueTestEmail(label), displayName: label, referralCode: uniqueTestReferralCode(), roles: { create: { role } } },
  })
  trackTestUser(user.id)
  return { user, token: createSessionToken(user) }
}

describe('Sham Cash STR host-plan proof — real stored receipt, pending admin approval, revenue on approve', () => {
  let app
  let admin
  let host

  beforeAll(async () => {
    app = await testApp()
    admin = await createUser('ADMIN', 'strproof-admin')
    host = await createUser('HOST', 'strproof-host')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  function submitProof(token, body) {
    return request(app).post('/api/payments/str-plan-sham-proof').set('authorization', `Bearer ${token}`).send(body)
  }

  it('creates a PENDING str_host_plan proof, prices by plan code (S6), and stores the receipt bytes', async () => {
    const ref = `SHAM-${Date.now()}-OK`
    const res = await submitProof(host.token, { planCode: 'premium', providerRef: ref, fileBase64: FAKE_RECEIPT_B64, mimeType: 'image/png' })
    expect(res.status).toBe(201)
    const proof = res.body.proof
    expect(proof.provider).toBe('str_host_plan')
    expect(proof.status).toBe('PENDING_ADMIN_REVIEW')
    expect(proof.amountMinor).toBe(49) // server table premium, never the client
    expect(proof.currency).toBe('USD')
    expect(proof.proofAssetUrl).toBe(`/api/payments/str-plan-sham-proof/${proof.id}/file`)

    const stored = await readPaymentProofFile(proof.id)
    expect(stored).not.toBeNull()
    expect(stored.mimeType).toBe('image/png')
    expect(stored.data.toString()).toBe('fake-receipt-bytes')
  })

  it('ignores a client-sent amount and always uses the server price', async () => {
    const res = await submitProof(host.token, { planCode: 'basic', providerRef: `SHAM-${Date.now()}-PRICE`, amountMinor: 1, fileBase64: FAKE_RECEIPT_B64, mimeType: 'image/png' })
    expect(res.status).toBe(201)
    expect(res.body.proof.amountMinor).toBe(9) // basic, not the injected 1
  })

  it('rejects a duplicate transaction reference', async () => {
    const ref = `SHAM-${Date.now()}-DUP`
    const first = await submitProof(host.token, { planCode: 'plus', providerRef: ref, fileBase64: FAKE_RECEIPT_B64, mimeType: 'image/png' })
    expect(first.status).toBe(201)
    const second = await submitProof(host.token, { planCode: 'plus', providerRef: ref, fileBase64: FAKE_RECEIPT_B64, mimeType: 'image/png' })
    expect(second.status).toBe(409)
    expect(second.body.error?.code).toBe('PAYMENT_REFERENCE_DUPLICATE')
  })

  it('requires the receipt file and a transaction reference', async () => {
    const noFile = await submitProof(host.token, { planCode: 'plus', providerRef: `SHAM-${Date.now()}-NOFILE` })
    expect(noFile.status).toBe(400)
    expect(noFile.body.error?.code).toBe('PAYMENT_PROOF_REQUIRED')
    const noRef = await submitProof(host.token, { planCode: 'plus', fileBase64: FAKE_RECEIPT_B64, mimeType: 'image/png' })
    expect(noRef.status).toBe(400)
    expect(noRef.body.error?.code).toBe('PAYMENT_REFERENCE_REQUIRED')
  })

  it('admin approval records the plan fee as str_host_plan revenue', async () => {
    const res = await submitProof(host.token, { planCode: 'hotel', providerRef: `SHAM-${Date.now()}-APPROVE`, fileBase64: FAKE_RECEIPT_B64, mimeType: 'image/png' })
    const proofId = res.body.proof.id
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId, actorUserId: admin.user.id, note: 'verified receipt' }))

    const credit = await db().walletEntry.findFirst({ where: { type: 'CREDIT', referenceType: 'str_host_plan_fee', referenceId: proofId } })
    expect(credit).not.toBeNull()
    expect(credit.amountMinor).toBe(100) // hotel
    // Isolation: approving an STR host plan must NOT create/approve a sellerProfile (no marketplace unlock).
    const profile = await db().sellerProfile.findUnique({ where: { userId: host.user.id } })
    expect(profile).toBeNull()
  })

  it('the receipt file is admin-only: an admin can read it, a host cannot', async () => {
    const res = await submitProof(host.token, { planCode: 'plus', providerRef: `SHAM-${Date.now()}-FILE`, fileBase64: FAKE_RECEIPT_B64, mimeType: 'image/png' })
    const proofId = res.body.proof.id
    const path = `/api/payments/str-plan-sham-proof/${proofId}/file`

    const asAdmin = await request(app).get(path).set('authorization', `Bearer ${admin.token}`)
    expect(asAdmin.status).toBe(200)
    expect(asAdmin.headers['content-type']).toContain('image/png')

    const asHost = await request(app).get(path).set('authorization', `Bearer ${host.token}`)
    expect(asHost.status).toBeGreaterThanOrEqual(401)
    expect(asHost.status).toBeLessThan(404)
  })
})
