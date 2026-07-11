import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { __resetRateLimitsForTests } from '../../server/lib/rate-limit.mjs'
import { cleanupTestUsers, testApp, trackTestUser, uniqueTestEmail } from '../support/testServer.mjs'

describe('POST /api/auth/register', () => {
  let app

  beforeAll(() => {
    app = testApp()
    __resetRateLimitsForTests()
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('creates a GUEST account with a valid email + password', async () => {
    const email = uniqueTestEmail('register-ok')
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
      displayName: 'Test Guest',
    })

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.user.email).toBe(email)
    expect(res.body.user.roles).toContain('GUEST')
    expect(typeof res.body.token).toBe('string')
    trackTestUser(res.body.user.id)
  })

  it('rejects a role that cannot be self-registered', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'ADMIN',
      email: uniqueTestEmail('register-admin'),
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ROLE_REGISTRATION_FORBIDDEN')
  })

  it('rejects a malformed email', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: 'not-an-email',
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_INVALID_EMAIL')
  })

  it('rejects an unknown field in the request body (F-09 defense-in-depth)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: uniqueTestEmail('register-unknown-field'),
      password: 'correct-horse-battery',
      isAdmin: true,
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_UNKNOWN_FIELDS')
  })

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueTestEmail('register-dup')
    const first = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'correct-horse-battery',
    })
    trackTestUser(first.body.user.id)

    const second = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email,
      password: 'a-different-password',
    })

    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('ACCOUNT_ALREADY_EXISTS')
  })
})

describe('POST /api/auth/login', () => {
  let app
  let registeredEmail

  beforeAll(async () => {
    app = testApp()
    __resetRateLimitsForTests()

    registeredEmail = uniqueTestEmail('login-target')
    const res = await request(app).post('/api/auth/register').send({
      role: 'GUEST',
      email: registeredEmail,
      password: 'correct-horse-battery',
    })
    trackTestUser(res.body.user.id)
  })

  afterAll(async () => {
    await cleanupTestUsers()
  })

  it('logs in with correct credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: registeredEmail,
      password: 'correct-horse-battery',
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.token).toBe('string')
  })

  it('rejects a wrong password with a generic 401', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: registeredEmail,
      password: 'totally-wrong',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects a nonexistent account with the identical status/code as a wrong password (F-03)', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: uniqueTestEmail('login-nonexistent'),
      password: 'irrelevant-password',
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(res.body.error.message).toBe('Invalid login credentials.')
  })

  it('rejects a request with neither email nor phone', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'irrelevant-password' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('LOGIN_IDENTIFIER_REQUIRED')
  })

  it('rejects an unknown field in the login body', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: registeredEmail,
      password: 'correct-horse-battery',
      rememberMe: true,
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_UNKNOWN_FIELDS')
  })

  it('rejects GET on the login route with 405', async () => {
    const res = await request(app).get('/api/auth/login')
    expect(res.status).toBe(405)
    expect(res.headers.allow).toContain('POST')
  })
})
