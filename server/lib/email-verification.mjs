import { db } from './prisma.mjs'
import { generateEmailVerificationCode, generateVerificationGrant, hashEmailVerificationCode, hashVerificationGrant, verifyEmailVerificationCodeHash } from './security.mjs'
import { isMailerConfigured, sendVerificationCodeEmail } from './mailer.mjs'

const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
// A successful verify() must be recent to count toward register() -- otherwise a code verified
// once, long ago, for a since-abandoned signup attempt would stay valid forever.
const CONSUMED_TRUST_WINDOW_MINUTES = 30
const OTP_RETENTION_HOURS = 24

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// Creates and stores a real, random, hashed code, then attempts real delivery. Always returns the
// stored-row truth (`emailSent`) rather than assuming success -- the caller must not claim the
// email was sent unless sendVerificationCodeEmail actually resolved. In non-production, also
// returns the raw code so local/QA testing works without a real mailbox (SMTP is rarely configured
// in dev) -- this is never included when NODE_ENV === 'production'.
export async function sendEmailVerificationCode(email, purpose = 'guest-signup') {
  const normalized = normalizeEmail(email)
  if (!normalized) {
    const error = new Error('email is required.')
    error.statusCode = 400
    error.code = 'EMAIL_REQUIRED'
    error.expose = true
    throw error
  }

  const isProduction = process.env.NODE_ENV === 'production'
  if (isProduction && !isMailerConfigured()) {
    const error = new Error('Email verification is temporarily unavailable.')
    error.statusCode = 503
    error.code = 'EMAIL_NOT_CONFIGURED'
    error.expose = true
    throw error
  }

  const code = generateEmailVerificationCode()
  const codeHash = hashEmailVerificationCode(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)

  await db().emailVerificationCode.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - OTP_RETENTION_HOURS * 60 * 60 * 1000) } },
  })
  await db().emailVerificationCode.create({
    data: { email: normalized, codeHash, purpose, expiresAt },
  })

  let emailSent = false
  let emailError
  // Send real mail in local/staging when Resend/SMTP is configured so owner QA can exercise
  // the exact staff access flow before launch. Tests stay isolated from external email delivery.
  if (process.env.NODE_ENV !== 'test' && isMailerConfigured()) {
    try {
      await sendVerificationCodeEmail(normalized, code)
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Unknown email error'
    }
  }


  if (isProduction && !emailSent) {
    const error = new Error('Email verification could not be delivered. Try again shortly.')
    error.statusCode = 503
    error.code = 'EMAIL_DELIVERY_FAILED'
    error.expose = true
    throw error
  }

  // Never expose a raw OTP from any hosted Vercel deployment, even if NODE_ENV is accidentally
  // scoped as development on a Preview deployment. Local development/tests have no VERCEL_ENV.
  const devCode = !isProduction && !process.env.VERCEL_ENV ? code : undefined
  return { ok: true, emailSent, emailError, devCode }
}

// Verifies + immediately consumes (single-use) the most recent, non-expired, non-consumed code
// for this email+purpose. Fails closed: wrong code, expired code, already-consumed code, or too
// many attempts on the same row all deny.
export async function consumeEmailVerificationCode(email, code, purpose = 'guest-signup') {
  const normalized = normalizeEmail(email)
  const candidate = await db().emailVerificationCode.findFirst({
    where: { email: normalized, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })

  if (!candidate || candidate.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
  }

  const matches = verifyEmailVerificationCodeHash(code, candidate.codeHash)
  if (!matches) {
    await db().emailVerificationCode.updateMany({
      where: { id: candidate.id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
  }

  const verificationGrant = generateVerificationGrant()
  const consumed = await db().emailVerificationCode.updateMany({
    where: { id: candidate.id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { consumedAt: new Date(), grantHash: hashVerificationGrant(verificationGrant) },
  })
  return consumed.count === 1 ? { ok: true, verificationGrant } : { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
}

// Consume the short-lived verification proof exactly once for the final action (register/login/reset).
// The code itself is consumed by verify(); claimedAt prevents replaying that proof for more actions.
export async function claimRecentlyVerifiedEmail(email, purpose = 'guest-signup', verificationGrant) {
  const normalized = normalizeEmail(email)
  if (!normalized || !verificationGrant) return false
  const since = new Date(Date.now() - CONSUMED_TRUST_WINDOW_MINUTES * 60 * 1000)
  const claimed = await db().emailVerificationCode.updateMany({
    where: { email: normalized, purpose, consumedAt: { gt: since }, claimedAt: null, grantHash: hashVerificationGrant(verificationGrant) },
    data: { claimedAt: new Date() },
  })
  return claimed.count === 1
}
