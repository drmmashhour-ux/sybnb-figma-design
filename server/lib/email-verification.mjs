import { db } from './prisma.mjs'
import { generateEmailVerificationCode, hashEmailVerificationCode, verifyEmailVerificationCodeHash } from './security.mjs'
import { isMailerConfigured, sanitizeEmailError, sendVerificationCodeEmail } from './mailer.mjs'

const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
// A successful verify() must be recent to count toward register() -- otherwise a code verified
// once, long ago, for a since-abandoned signup attempt would stay valid forever.
const CONSUMED_TRUST_WINDOW_MINUTES = 30

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

  const code = generateEmailVerificationCode()
  const codeHash = hashEmailVerificationCode(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000)

  // Single-active-code invariant (Q2) + row hygiene (item 9), atomically: delete EVERY prior
  // unconsumed code for this email+purpose (expired or not), then create the new one, in one
  // transaction so a concurrent verifier never observes a window with zero valid codes. This makes
  // "only the newest code is valid" an explicit invariant rather than an emergent property of
  // consume()'s ordering, removes the concurrent same-instant tie where a valid code could look
  // invalid, and stops stale codes from accumulating. Consumed rows are NEVER touched — the 30-min
  // trust window (hasRecentlyVerifiedEmail) depends on them — and only this email+purpose is
  // affected. Scoped by the existing [email, purpose] index; no schema change. Not best-effort:
  // invalidation is a correctness step, so a DB failure here correctly fails the whole issuance.
  await db().$transaction([
    db().emailVerificationCode.deleteMany({ where: { email: normalized, purpose, consumedAt: null } }),
    db().emailVerificationCode.create({ data: { email: normalized, codeHash, purpose, expiresAt } }),
  ])

  const isProduction = process.env.NODE_ENV === 'production'
  let emailSent = false
  // Item 6: attempt real delivery whenever a provider is configured (read at CALL time). A definitive
  // delivery failure (after mailer.mjs's bounded retry) throws EMAIL_SEND_FAILED (502) rather than
  // returning a misleading ok:true — the client must see a real failure, not a false "code sent".
  // The generic vs detailed message is decided by sanitizeEmailError (item 5): production never
  // leaks provider/URL/status detail. devCode stays the dev-only fallback and is never set in prod.
  if (isMailerConfigured()) {
    try {
      await sendVerificationCodeEmail(normalized, code)
      emailSent = true
    } catch (error) {
      const err = new Error(sanitizeEmailError(error instanceof Error ? error.message : undefined, { isProduction }))
      err.statusCode = 502
      err.code = 'EMAIL_SEND_FAILED'
      err.expose = true
      throw err
    }
  }

  const devCode = isProduction ? undefined : code
  return { ok: true, emailSent, devCode }
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
    await db().emailVerificationCode.update({
      where: { id: candidate.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, reason: 'INVALID_OR_EXPIRED_CODE' }
  }

  await db().emailVerificationCode.update({
    where: { id: candidate.id },
    data: { consumedAt: new Date() },
  })
  return { ok: true }
}

// Server-side proof, at register() time, that this exact email really was verified recently --
// never trusts a client-supplied "I verified it" boolean.
export async function hasRecentlyVerifiedEmail(email, purpose = 'guest-signup') {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  const since = new Date(Date.now() - CONSUMED_TRUST_WINDOW_MINUTES * 60 * 1000)
  const verified = await db().emailVerificationCode.findFirst({
    where: { email: normalized, purpose, consumedAt: { gt: since } },
    orderBy: { consumedAt: 'desc' },
  })
  return Boolean(verified)
}
