import { db } from '../lib/prisma.mjs'
import { createSessionToken, hashPassword, hashPhone, verifyPassword } from '../lib/security.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { assertNoUnknownFields, assertValidEmail, assertValidPhone } from '../lib/validate.mjs'

const PUBLIC_REGISTER_ROLES = new Set(['GUEST', 'HOST', 'SELLER', 'DRIVER'])

// A hash of a value nobody will ever type as a real password — used only to give the "no such
// account" path the same scrypt cost as the "wrong password" path (security audit finding F-03).
// Without this, verifyPassword() is skipped entirely when no user matches, making that response
// measurably faster and letting an attacker enumerate registered accounts via response timing
// even though the error message is identical either way.
const DUMMY_PASSWORD_HASH = hashPassword('not-a-real-password-timing-decoy')

export async function handleAuth(req, res, url) {
  if (url.pathname === '/api/auth/register') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['role', 'email', 'phone', 'password', 'displayName', 'firstName', 'lastName'], 'registration body')
    const role = body.role || 'GUEST'
    if (!PUBLIC_REGISTER_ROLES.has(role)) {
      const error = new Error('This role cannot be self-registered.')
      error.statusCode = 403
      error.code = 'ROLE_REGISTRATION_FORBIDDEN'
      error.expose = true
      throw error
    }

    if (!body.email && !body.phone) {
      const error = new Error('email or phone is required.')
      error.statusCode = 400
      error.code = 'REGISTER_IDENTIFIER_REQUIRED'
      error.expose = true
      throw error
    }

    const validEmail = body.email ? assertValidEmail(body.email) : undefined
    const validPhone = body.phone ? assertValidPhone(body.phone) : undefined

    const phoneHash = validPhone ? hashPhone(validPhone) : undefined
    const passwordHash = hashPassword(body.password)

    try {
      const user = await db().user.create({
        data: {
          email: validEmail,
          phoneHash,
          passwordHash,
          displayName: body.displayName || validEmail || 'SYBNB User',
          roles: {
            create: { role },
          },
          wallets: {
            create: { currency: 'SYP' },
          },
        },
        include: { roles: true },
      })

      return json(res, 201, {
        ok: true,
        user: publicUser(user),
        token: createSessionToken(user),
      })
    } catch (error) {
      if (error?.code === 'P2002') {
        const conflict = new Error('An account with this email or phone already exists.')
        conflict.statusCode = 409
        conflict.code = 'ACCOUNT_ALREADY_EXISTS'
        conflict.expose = true
        throw conflict
      }
      throw error
    }
  }

  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    const body = await readJson(req)
    assertNoUnknownFields(body, ['email', 'phone', 'password'], 'login body')
    const where = body.email
      ? { email: body.email }
      : body.phone
        ? { phoneHash: hashPhone(body.phone) }
        : undefined

    if (!where) {
      const error = new Error('email or phone is required.')
      error.statusCode = 400
      error.code = 'LOGIN_IDENTIFIER_REQUIRED'
      error.expose = true
      throw error
    }

    const user = await db().user.findUnique({ where, include: { roles: true } })
    // Security audit finding F-03: always run verifyPassword, even when no user matched, using a
    // fixed decoy hash in that case. Without this, the "no such account" branch short-circuits
    // before the expensive scrypt call runs, making it measurably faster than "account exists,
    // wrong password" — an attacker can enumerate registered accounts via response timing even
    // though the error message is identical either way.
    const passwordOk = verifyPassword(body.password, user?.passwordHash || DUMMY_PASSWORD_HASH)
    if (!user || user.status !== 'ACTIVE' || !passwordOk) {
      const error = new Error('Invalid login credentials.')
      error.statusCode = 401
      error.code = 'INVALID_CREDENTIALS'
      error.expose = true
      throw error
    }

    return json(res, 200, {
      ok: true,
      user: publicUser(user),
      token: createSessionToken(user),
    })
  }

  return false
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    status: user.status,
    roles: user.roles.map((item) => item.role),
  }
}
