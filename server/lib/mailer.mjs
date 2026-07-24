import nodemailer from 'nodemailer'
import { safePositiveInt } from './rate-limit.mjs'

const RESEND_API_URL = 'https://api.resend.com/emails'

// Resend delivery hardening (2026-07-22). Timeout + bounded transient-only retry for the Resend HTTP
// call; overridable via env, with safe defaults that work with zero configuration.
const DEFAULT_EMAIL_TIMEOUT_MS = 10_000
const DEFAULT_EMAIL_MAX_ATTEMPTS = 3
const DEFAULT_EMAIL_RETRY_BASE_MS = 300

// Item 2: provider detection reads process.env at CALL time (not a module-level constant captured at
// import). On Vercel platform env is present before import, but local `node server/index.mjs` runs
// loadEnv() AFTER imports, and the production boot-guard (validateProductionConfig) must reflect the
// real current environment — so every check below recomputes from process.env on each call.
function currentProvider() {
  return (process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : 'smtp')).toLowerCase()
}

function isResendConfigured() {
  return currentProvider() === 'resend' && Boolean(process.env.RESEND_API_KEY)
}

export function isMailerConfigured() {
  // SMTP availability is keyed on SMTP_HOST (same semantics as before, when a transporter was created
  // iff SMTP_HOST was set) — read at call time here so detection tracks the current environment.
  return isResendConfigured() || Boolean(process.env.SMTP_HOST)
}

export function requireMailer() {
  if (!isMailerConfigured()) {
    const error = new Error('Email delivery is not configured on this server yet.')
    error.statusCode = 503
    error.code = 'EMAIL_NOT_CONFIGURED'
    error.expose = true
    throw error
  }
}

// Item 5: user-facing message for a delivery failure. Generic in production (never leaks Resend URLs,
// status text, provider messages, API detail, or stack traces); detailed outside production for
// debugging. Pure — unit-tested directly.
const GENERIC_EMAIL_FAILURE = 'Unable to send the verification email right now. Please try again.'
export function sanitizeEmailError(rawMessage, { isProduction } = {}) {
  if (isProduction) return GENERIC_EMAIL_FAILURE
  return rawMessage || GENERIC_EMAIL_FAILURE
}

// SMTP transporter is created lazily (call-time) so isMailerConfigured() above can reflect the
// current env without an import-time capture. Cached once created; tests do not exercise SMTP.
let smtpTransporter = null
function getSmtpTransporter() {
  if (!process.env.SMTP_HOST) return null
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    })
  }
  return smtpTransporter
}

function fromAddress() {
  const name = process.env.EMAIL_FROM_NAME || 'SYBNB'
  const address = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'no-reply@sybnb.local'
  return address.includes('<') ? address : `${name} <${address}>`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Backoff base may legitimately be 0 (tests, or immediate retries), which safePositiveInt rejects in
// favor of the default — parse it with a >= 0 rule of its own.
function readNonNegativeInt(rawValue, fallback) {
  if (rawValue === undefined || rawValue === '') return fallback
  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return fallback
  return parsed
}

// Items 3 & 4: the Resend HTTP send with an AbortController timeout and bounded retry for TRANSIENT
// failures only — network error, timeout, HTTP 429, HTTP 5xx. An ordinary 4xx (bad recipient, auth)
// throws on the first attempt and is never retried.
async function resendSend({ to, subject, text }) {
  const timeoutMs = safePositiveInt(process.env.EMAIL_SEND_TIMEOUT_MS, DEFAULT_EMAIL_TIMEOUT_MS)
  const maxAttempts = safePositiveInt(process.env.EMAIL_MAX_ATTEMPTS, DEFAULT_EMAIL_MAX_ATTEMPTS)
  const baseBackoffMs = readNonNegativeInt(process.env.EMAIL_RETRY_BASE_MS, DEFAULT_EMAIL_RETRY_BASE_MS)

  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    let networkError
    try {
      response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [to],
          reply_to: process.env.EMAIL_REPLY_TO || undefined,
          subject,
          text,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      networkError = error
    } finally {
      clearTimeout(timer)
    }

    if (response) {
      const body = await response.json().catch(() => ({}))
      if (response.ok) return body
      const transient = response.status === 429 || response.status >= 500
      const httpError = new Error(body.message || `Resend request failed (${response.status})`)
      httpError.statusCode = 502
      if (!transient) throw httpError // ordinary 4xx: permanent, no retry
      lastError = httpError
    } else {
      lastError = controller.signal.aborted
        ? new Error(`Resend request timed out after ${timeoutMs}ms`)
        : (networkError instanceof Error ? networkError : new Error('Resend request failed'))
      lastError.statusCode = 502
    }

    if (attempt >= maxAttempts) throw lastError
    if (baseBackoffMs > 0) await sleep(baseBackoffMs * attempt)
  }

  throw lastError // unreachable (loop throws on final attempt)
}

// Single send path shared by both providers -- callers never touch nodemailer/Resend directly,
// so isMailerConfigured()/requireMailer() stay the only two things they need to know about.
async function deliver({ to, subject, text }) {
  requireMailer()
  if (isResendConfigured()) {
    return resendSend({ to, subject, text })
  }
  return getSmtpTransporter().sendMail({ from: fromAddress(), to, subject, text })
}

// SYB-003 — transactional email primitive. Reuses the same deliver() path (Resend or SMTP) as every
// other mail. Throws like deliver() on a mailer error; the notifications layer wraps it best-effort.
export async function sendTransactionalEmail({ to, subject, text }) {
  return deliver({ to, subject, text })
}

// Best-effort — the caller decides what to do on failure (record emailError, never fabricate
// emailSentAt unless this actually resolves).
export async function sendHostInsightEmail(user, insight) {
  const subject = insight.messageEn ? 'SYBNB pricing insight' : 'توصية تسعير من SYBNB'
  const text = [insight.messageAr, insight.messageEn].filter(Boolean).join('\n\n')
  return deliver({ to: user.email, subject, text })
}

// Real email delivery for guest-signup verification codes. Chosen over SMS: no per-message
// carrier cost and no international-SMS-gateway account needed for the Syria market this stage
// targets. Throws EMAIL_NOT_CONFIGURED (503) when neither provider is set up -- the caller
// (email-verification.mjs) still creates and stores the real code either way, and surfaces a
// dev-only fallback so local/QA testing keeps working without a real mailbox.
export async function sendVerificationCodeEmail(email, code) {
  return deliver({
    to: email,
    subject: `SYBNB — رمز التحقق ${code}`,
    text: `رمز التحقق الخاص بك: ${code}\nSYBNB verification code: ${code}\n\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.\nValid for 10 minutes. Do not share this code with anyone.`,
  })
}
