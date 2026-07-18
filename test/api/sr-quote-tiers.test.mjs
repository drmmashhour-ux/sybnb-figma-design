import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail, verifyEmailForTest } from '../support/testServer.mjs'

// SR-XXL: the fourth vehicle tier (added alongside Economy/Comfort/SUV) should quote strictly
// higher than SUV for the same trip, since it's priced as the largest-capacity/premium option.
describe('SR ride quote: all four tiers', () => {
  let app
  let riderToken

  beforeAll(async () => {
    app = testApp()
    const email = uniqueTestEmail('quote-tiers')
    await verifyEmailForTest(app, email)
    const res = await request(app).post('/api/auth/register').send({ role: 'GUEST', email, password: 'correct-horse-battery' })
    trackTestUser(res.body.user.id)
    riderToken = res.body.token
  })
  afterAll(async () => {
    await cleanupTestUsers()
  })

  async function quote(category) {
    const res = await request(app)
      .post('/api/sr/quote')
      .set('Authorization', `Bearer ${riderToken}`)
      .send({ pickup: 'Damascus, Malki', dropoff: 'Damascus, Mezzeh', category, lowDataMode: true })
    expect(res.status).toBe(200)
    return res.body.quote.fareMinor
  }

  it('quotes SR XXL strictly higher than SR SUV, which is strictly higher than Comfort, which is strictly higher than Economy', async () => {
    const economy = await quote('SR Economy')
    const comfort = await quote('SR Comfort')
    const suv = await quote('SR SUV')
    const xxl = await quote('SR XXL')

    expect(comfort).toBeGreaterThan(economy)
    expect(suv).toBeGreaterThan(comfort)
    expect(xxl).toBeGreaterThan(suv)
  })

  it('falls back to Economy pricing for an unrecognized category rather than erroring', async () => {
    const unknown = await quote('SR Motorbike')
    const economy = await quote('SR Economy')
    expect(unknown).toBe(economy)
  })
})
