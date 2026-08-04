import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../server/lib/prisma.mjs'
import { createSessionToken } from '../../server/lib/security.mjs'
import { recordWalletEntry } from '../../server/lib/finance-ledger.mjs'
import { approveDriverForRides, cleanupTestUsers, fundWallet, testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode, verifyEmailForTest } from '../support/testServer.mjs'

// SR audit-fix regressions: (1) one active ride per rider; (2) driver payout releases ONLY real SR
// earnings — never a rider top-up that shares the same wallet.
describe('SR polish fixes', () => {
  let app
  let admin

  beforeAll(async () => {
    app = testApp()
    admin = await db().user.create({
      data: { email: uniqueTestEmail('sr-polish-admin'), displayName: 'A', referralCode: uniqueTestReferralCode(), roles: { create: { role: 'ADMIN' } } },
      include: { roles: true },
    })
    trackTestUser(admin.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function registerUser(role, label) {
    const email = uniqueTestEmail(label)
    let verificationGrant
    if (role === 'GUEST') verificationGrant = await verifyEmailForTest(app, email)
    if (role === 'DRIVER') verificationGrant = await verifyEmailForTest(app, email, 'staff-login')
    const res = await request(app).post('/api/auth/register').send({ verificationGrant, role, email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    if (role === 'DRIVER') await approveDriverForRides(res.body.user.id)
    if (role === 'GUEST') await fundWallet(res.body.user.id)
    return { token: res.body.token, user: res.body.user }
  }

  const requestRide = (token, label) =>
    request(app).post('/api/sr/rides').set('Authorization', `Bearer ${token}`).send({ pickup: `p ${label}`, dropoff: `d ${label}`, category: 'SR Economy' })

  it('a rider cannot request a second ride while one is active (409 RIDER_HAS_ACTIVE_RIDE)', async () => {
    const rider = await registerUser('GUEST', 'guard-rider')
    const first = await requestRide(rider.token, 'g1')
    expect(first.status).toBe(201)
    const second = await requestRide(rider.token, 'g2')
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('RIDER_HAS_ACTIVE_RIDE')
  })

  it('driver payout releases ONLY earnings, never a rider top-up in the same wallet', async () => {
    const rider = await registerUser('GUEST', 'payout-rider2')
    const driver = await registerUser('DRIVER', 'payout-driver2')

    // Complete a real ride → the driver earns 85% of the fare (an sr_driver_earning CREDIT).
    const rideId = (await requestRide(rider.token, 'pay')).body.ride.id
    await request(app).patch(`/api/sr/rides/${rideId}/claim`).set('Authorization', `Bearer ${driver.token}`)
    await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'DRIVER_ARRIVING' })
    await db().rideRequest.update({ where: { id: rideId }, data: { pickupVerifiedAt: new Date() } })
    await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'IN_PROGRESS' })
    await request(app).patch(`/api/driver/rides/${rideId}/status`).set('Authorization', `Bearer ${driver.token}`).send({ status: 'COMPLETED' })

    const walletAfterEarning = await db().wallet.findFirst({ where: { userId: driver.user.id, currency: 'SYP' } })
    const earning = walletAfterEarning.cachedBalanceMinor
    expect(earning).toBeGreaterThan(0)

    // The driver is also a rider who topped up their wallet — a non-earning CREDIT in the SAME wallet.
    const topup = 500_000
    await recordWalletEntry(db(), {
      userId: driver.user.id, type: 'CREDIT', amountMinor: topup, currency: 'SYP',
      referenceType: 'wallet_topup', referenceId: 'sr-polish-topup',
      keyParts: ['sr-polish-topup', driver.user.id], note: 'simulated rider top-up',
    })

    const saved = await request(app).put('/api/driver/payout').set('Authorization', `Bearer ${driver.token}`).send({ accountHolder: 'Test Driver', shamCashNumber: '0999000111' })
    expect(saved.status).toBe(200)
    expect(saved.body.payout).toMatchObject({ accountHolder: 'Test Driver', last4: '0111' })
    expect(JSON.stringify(saved.body)).not.toContain('0999000111')
    const stored = await db().user.findUnique({ where: { id: driver.user.id }, select: { payoutMethod: true } })
    expect(stored.payoutMethod.ciphertext).toBeTruthy()
    expect(JSON.stringify(stored.payoutMethod)).not.toContain('0999000111')

    const queue = await request(app).get('/api/admin/sr-payouts').set('Authorization', `Bearer ${createSessionToken(admin)}`)
    expect(queue.status).toBe(200)
    expect(queue.body.payouts.find((row) => row.driverId === driver.user.id)).toMatchObject({ accruedMinor: earning, payoutMethod: { last4: '0111' } })
    const payout = await request(app)
      .post(`/api/admin/sr-payouts/${driver.user.id}/release`)
      .set('Authorization', `Bearer ${createSessionToken(admin)}`)
      .send({ payoutRef: 'sr-polish-ref', currency: 'SYP' })

    expect(payout.status).toBe(200)
    // Only the earning is paid out — NOT the top-up.
    expect(payout.body.walletEntry.amountMinor).toBe(earning)
    // The top-up is untouched and remains in the wallet.
    const walletAfterPayout = await db().wallet.findFirst({ where: { userId: driver.user.id, currency: 'SYP' } })
    expect(walletAfterPayout.cachedBalanceMinor).toBe(topup)
  })
})
