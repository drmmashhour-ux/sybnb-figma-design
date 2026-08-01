import { createHmac } from 'node:crypto'
import { db } from './prisma.mjs'

// Per-ACCOUNT login lockout — a defense-in-depth layer ON TOP of the per-IP rate limit in
// server/index.mjs (AUTH_LOGIN, 10/5min). The per-IP limit stops ONE machine hammering /login; this
// stops a DISTRIBUTED / rotating-IP attack from brute-forcing a SINGLE target account, because it keys
// on the identifier (email/phone), not the source IP: after too many failed attempts on one account,
// that account is briefly locked regardless of how many IPs the attacker spreads across.
//
// Reuses the generic `otp_attempt_locks` table with purpose='login' (it already exists in the baseline
// migration and was otherwise unused) — so this ships with NO new migration. Identifiers are HMAC-hashed
// before storage, so a DB dump never reveals which real emails/phones were targeted.

const PURPOSE = 'login'

function safeInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && Number.isInteger(n) && n >= 1 ? n : fallback
}

// Tunable via env without a code change (mirrors the rate-limit policy convention). Defaults: lock an
// account after 8 failed attempts inside a 15-minute window, for 15 minutes.
const MAX_FAILED_ATTEMPTS = safeInt(process.env.LOGIN_LOCK_MAX_ATTEMPTS, 8)
const ATTEMPT_WINDOW_MS = safeInt(process.env.LOGIN_LOCK_WINDOW_MS, 15 * 60 * 1000)
const LOCK_DURATION_MS = safeInt(process.env.LOGIN_LOCK_DURATION_MS, 15 * 60 * 1000)

export const LOGIN_LOCK_POLICY = { MAX_FAILED_ATTEMPTS, ATTEMPT_WINDOW_MS, LOCK_DURATION_MS }

// HMAC (not a plain hash) so the stored value can't be reversed via a rainbow table of common emails,
// and so a DB dump doesn't reveal the attacked accounts. AUTH_SECRET is always present in production
// (validateProductionConfig enforces it); a fixed dev salt keeps local/dev + tests working without it.
export function hashLoginSubject(identifier) {
  const secret = process.env.AUTH_SECRET || 'sybnb-dev-login-lock-salt'
  return createHmac('sha256', secret).update(String(identifier || '').trim().toLowerCase()).digest('hex')
}

// Called BEFORE credential verification. Returns { locked, retryAfterSeconds, lockedUntil }. Never
// throws — a lock-store outage FAILS OPEN (availability wins; the per-IP limit still applies).
export async function checkLoginLock(subjectHash, client = db()) {
  try {
    const row = await client.otpAttemptLock.findUnique({
      where: { purpose_subjectHash: { purpose: PURPOSE, subjectHash } },
    })
    if (row?.lockedUntil && row.lockedUntil > new Date()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000))
      return { locked: true, retryAfterSeconds, lockedUntil: row.lockedUntil }
    }
  } catch (error) {
    console.error('[login-lock] store unavailable — allowing login attempt:', error?.message || error)
  }
  return { locked: false }
}

// Called AFTER a failed credential check. Opens a fresh counting window when there's no live one,
// otherwise increments it; locks the account when the count crosses the threshold. Returns
// { justLocked, attemptCount, lockedUntil } (justLocked=true only on the transition INTO a lock, so the
// caller raises exactly one security alert per lockout). Never throws.
export async function recordLoginFailure(subjectHash, client = db()) {
  try {
    const now = new Date()
    const existing = await client.otpAttemptLock.findUnique({
      where: { purpose_subjectHash: { purpose: PURPOSE, subjectHash } },
    })
    const stillLocked = Boolean(existing?.lockedUntil && existing.lockedUntil > now)
    const windowExpired =
      !existing ||
      !existing.lastAttemptAt ||
      now.getTime() - existing.lastAttemptAt.getTime() > ATTEMPT_WINDOW_MS
    // While already locked, keep the count/lock as-is (don't extend on every blocked probe). Otherwise
    // start a new window at 1 if the old one expired, else increment the live window.
    const attemptCount = stillLocked ? existing.attemptCount : windowExpired ? 1 : existing.attemptCount + 1
    const justLocked = !stillLocked && attemptCount >= MAX_FAILED_ATTEMPTS
    const lockedUntil = justLocked
      ? new Date(now.getTime() + LOCK_DURATION_MS)
      : stillLocked
        ? existing.lockedUntil
        : null

    await client.otpAttemptLock.upsert({
      where: { purpose_subjectHash: { purpose: PURPOSE, subjectHash } },
      create: { purpose: PURPOSE, subjectHash, attemptCount, lastAttemptAt: now, lockedUntil },
      update: { attemptCount, lastAttemptAt: now, lockedUntil },
    })
    return { justLocked, attemptCount, lockedUntil }
  } catch (error) {
    console.error('[login-lock] failed to record login failure:', error?.message || error)
    return { justLocked: false, attemptCount: 0, lockedUntil: null }
  }
}

// Called after a SUCCESSFUL credential check — clears the failure counter so a legitimate user who was
// near (but not over) the threshold starts clean next time. Never throws.
export async function clearLoginFailures(subjectHash, client = db()) {
  try {
    await client.otpAttemptLock.deleteMany({ where: { purpose: PURPOSE, subjectHash } })
  } catch (error) {
    console.error('[login-lock] failed to clear login failures:', error?.message || error)
  }
}

// How many accounts are currently locked (for the admin office dashboard's security panel).
export async function countActiveLoginLocks(client = db()) {
  try {
    return await client.otpAttemptLock.count({
      where: { purpose: PURPOSE, lockedUntil: { gt: new Date() } },
    })
  } catch {
    return 0
  }
}
