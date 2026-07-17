import { db } from './prisma.mjs'
import { generateEmailVerificationCode, hashEmailVerificationCode, verifyEmailVerificationCodeHash } from './security.mjs'
import { isSmsConfigured, sendVerificationCodeSms } from './sms-sender.mjs'

// Phone/SMS one-time codes — the exact same security model as the email flow (short random code, HMAC
// hash, 10-min TTL, single-use, attempt-limited, 30-min consumed-trust window), delivered by SMS instead
// of email. Reuses the email code-gen/hash helpers (they are channel-agnostic). Registration/sign-in
// accepts a recently-verified EMAIL *or* PHONE, so a user can prove ownership by whichever they have.
const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const CONSUMED_TRUST_WINDOW_MINUTES = 30

function normalizePhone(phone) {
  return String(phone || '').trim()
}

export async function sendPhoneVerificationCode(phone, purpose = 'guest-signup') {
  const normalized = normalizePhone(phone)
  if (!normalized) {
    const error = new Error('phone is required.')
    error.statusCode = 400
    error.code = 'PHONE_REQUIRED'
    error.expose = true
    throw error
  }

  const code = generateEmailVerificationCode()
  const codeHash = hashEmailVerificationCode(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)

  await db().phoneVerificationCode.create({
    data: { phone: normalized, codeHash, purpose, expiresAt },
  })

  const isProduction = process.env.NODE_ENV === 'production'
  let smsSent = false
  let smsError
  // Send a real SMS in local/staging when a provider is configured; tests stay isolated from delivery.
  if (process.env.NODE_ENV !== 'test' && isSmsConfigured()) {
    try {
      await sendVerificationCodeSms(normalized, code)
      smsSent = true
    } catch (error) {
      smsError = error instanceof Error ? error.message : 'Unknown SMS error'
    }
  }

  const devCode = isProduction ? undefined : code
  return { ok: true, smsSent, smsError, devCode }
}

export async function consumePhoneVerificationCode(phone, code, purpose = 'guest-signup') {
  const normalized = normalizePhone(phone)
  const candidate = await db().phoneVerificationCode.findFirst({
    where: { phone: normalized, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!candidate || candidate.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
  }

  const matches = verifyEmailVerificationCodeHash(code, candidate.codeHash)
  if (!matches) {
    await db().phoneVerificationCode.update({ where: { id: candidate.id }, data: { attempts: { increment: 1 } } })
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
  }

  await db().phoneVerificationCode.update({ where: { id: candidate.id }, data: { consumedAt: new Date() } })
  return { ok: true }
}

export async function hasRecentlyVerifiedPhone(phone, purpose = 'guest-signup') {
  const normalized = normalizePhone(phone)
  if (!normalized) return false
  const since = new Date(Date.now() - CONSUMED_TRUST_WINDOW_MINUTES * 60 * 1000)
  const verified = await db().phoneVerificationCode.findFirst({
    where: { phone: normalized, purpose, consumedAt: { gt: since } },
    orderBy: { consumedAt: 'desc' },
  })
  return Boolean(verified)
}
