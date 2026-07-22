import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../server/lib/security.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// C5 — the host dashboard's "Verified host" line and trust score read `overview.host.idDocumentStatus`
// from GET /api/host/overview. This locks down that the value a host can reach that field with is
// the real, admin-reviewed one: a HOST submitting their own ID lands on PENDING_REVIEW and stays
// there until an ADMIN approves. The generic state machine is covered by verification-states.test.mjs;
// what is asserted here is specifically the HOST role and the host-overview surface the dashboard reads.

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

async function registerHost(app, label) {
  const email = uniqueTestEmail(label)
  // HOST is in STAFF_ROLES_REQUIRING_OTP — register through the same real email-code gate a host uses.
  await verifyEmailForTest(app, email, 'staff-login')
  const res = await request(app).post('/api/auth/register').send({
    role: 'HOST',
    email,
    password: 'correct-horse-battery',
  })
  trackTestUser(res.body.user?.id)
  return { email, token: res.body.token, user: res.body.user }
}

async function createAdmin(label) {
  const user = await db().user.create({
    data: {
      email: uniqueTestEmail(label),
      passwordHash: hashPassword('correct-horse-battery'),
      displayName: 'Test ADMIN',
      referralCode: uniqueTestReferralCode(),
      roles: { create: { role: 'ADMIN' } },
    },
    include: { roles: true },
  })
  trackTestUser(user.id)
  return { token: createSessionToken(user), user }
}

function hostOverview(app, token) {
  return request(app).get('/api/host/overview').set('Authorization', `Bearer ${token}`)
}

describe('C5 host identity verification via the host overview', () => {
  let app
  let admin

  beforeAll(async () => {
    app = testApp()
    admin = await createAdmin('c5-admin')
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('a brand-new host is not verified on the surface the dashboard reads', async () => {
    const host = await registerHost(app, 'c5-fresh')
    const res = await hostOverview(app, host.token)

    expect(res.status).toBe(200)
    expect(res.body.overview.host.idDocumentStatus).not.toBe('APPROVED')
  })

  it('a HOST can submit a real ID document and lands on PENDING_REVIEW', async () => {
    const host = await registerHost(app, 'c5-submit')
    const submit = await request(app)
      .patch('/api/me/id-document')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png' })

    expect(submit.status).toBe(200)
    expect(submit.body.user.idDocumentStatus).toBe('PENDING_REVIEW')
    // The bytes were actually stored — a reference exists, not just a status flip.
    expect(submit.body.user.idDocumentRef).toBeTruthy()

    const overview = await hostOverview(app, host.token)
    expect(overview.body.overview.host.idDocumentStatus).toBe('PENDING_REVIEW')
  })

  it('submitting alone never makes the host verified — only an ADMIN decision does', async () => {
    const host = await registerHost(app, 'c5-approve')
    await request(app)
      .patch('/api/me/id-document')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png' })

    const beforeReview = await hostOverview(app, host.token)
    expect(beforeReview.body.overview.host.idDocumentStatus).toBe('PENDING_REVIEW')

    const decision = await request(app)
      .patch(`/api/admin/review-queue/iddocument/${host.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'APPROVE' })
    expect(decision.status).toBe(200)

    const afterReview = await hostOverview(app, host.token)
    expect(afterReview.body.overview.host.idDocumentStatus).toBe('APPROVED')
  })

  it('a host cannot set their own idDocumentStatus to APPROVED through the submission endpoint', async () => {
    const host = await registerHost(app, 'c5-self-approve')
    const submit = await request(app)
      .patch('/api/me/id-document')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png', idDocumentStatus: 'APPROVED' })

    expect(submit.status).toBe(200)
    expect(submit.body.user.idDocumentStatus).toBe('PENDING_REVIEW')

    const overview = await hostOverview(app, host.token)
    expect(overview.body.overview.host.idDocumentStatus).toBe('PENDING_REVIEW')
  })

  it('a rejected host is not verified on the host overview', async () => {
    const host = await registerHost(app, 'c5-rejected')
    await request(app)
      .patch('/api/me/id-document')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ fileBase64: TINY_PNG_BASE64, mimeType: 'image/png' })
    await request(app)
      .patch(`/api/admin/review-queue/iddocument/${host.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ decision: 'REJECT' })

    const overview = await hostOverview(app, host.token)
    expect(overview.body.overview.host.idDocumentStatus).toBe('REJECTED')
  })
})
