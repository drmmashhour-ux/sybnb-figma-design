import { db } from './prisma.mjs'
import { generateEmailVerificationCode, generateVerificationGrant, hashEmailVerificationCode, hashVerificationGrant, verifyEmailVerificationCodeHash } from './security.mjs'
import { isSmsConfigured, sendVerificationCodeSms } from './sms-sender.mjs'

// Phone/SMS one-time codes — the exact same security model as the email flow (short random code, HMAC
// hash, 10-min TTL, single-use, attempt-limited, 30-min consumed-trust window), delivered by SMS instead
// of email. Reuses the email code-gen/hash helpers (they are channel-agnostic). Registration/sign-in
// accepts a recently-verified EMAIL *or* PHONE, so a user can prove ownership by whichever they have.
const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const CONSUMED_TRUST_WINDOW_MINUTES = 30
const OTP_RETENTION_HOURS = 24

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

  const isProduction = process.env.NODE_ENV === 'production'
  if (isProduction && !isSmsConfigured()) {
    const error = new Error('Phone verification is temporarily unavailable.')
    error.statusCode = 503
    error.code = 'SMS_NOT_CONFIGURED'
    error.expose = true
    throw error
  }

  const code = generateEmailVerificationCode()
  const codeHash = hashEmailVerificationCode(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)

  await db().phoneVerificationCode.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - OTP_RETENTION_HOURS * 60 * 60 * 1000) } },
  })
  await db().phoneVerificationCode.create({
    data: { phone: normalized, codeHash, purpose, expiresAt },
  })

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

  if (isProduction && !smsSent) {
    const error = new Error('Phone verification could not be delivered. Try again shortly.')
    error.statusCode = 503
    error.code = 'SMS_DELIVERY_FAILED'
    error.expose = true
    throw error
  }

  // Never expose a raw OTP from any hosted Vercel deployment, even if NODE_ENV is accidentally
  // scoped as development on a Preview deployment. Local development/tests have no VERCEL_ENV.
  const devCode = !isProduction && !process.env.VERCEL_ENV ? code : undefined
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
    await db().phoneVerificationCode.updateMany({
      where: { id: candidate.id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
  }

  const verificationGrant = generateVerificationGrant()
  const consumed = await db().phoneVerificationCode.updateMany({
    where: { id: candidate.id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { consumedAt: new Date(), grantHash: hashVerificationGrant(verificationGrant) },
  })
  return consumed.count === 1 ? { ok: true, verificationGrant } : { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
}

export async function claimRecentlyVerifiedPhone(phone, purpose = 'guest-signup', verificationGrant) {
  const normalized = normalizePhone(phone)
  if (!normalized || !verificationGrant) return false
  const since = new Date(Date.now() - CONSUMED_TRUST_WINDOW_MINUTES * 60 * 1000)
  const claimed = await db().phoneVerificationCode.updateMany({
    where: { phone: normalized, purpose, consumedAt: { gt: since }, claimedAt: null, grantHash: hashVerificationGrant(verificationGrant) },
    data: { claimedAt: new Date() },
  })
  return claimed.count === 1
}
