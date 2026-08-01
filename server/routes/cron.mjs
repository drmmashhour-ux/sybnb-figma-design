import { db } from '../lib/prisma.mjs'
import { json } from '../lib/responses.mjs'
import { completeExpiredBookings } from '../lib/booking-lifecycle.mjs'
import { expireOldListings, purgeStaleListingMedia } from '../lib/listing-lifecycle.mjs'
import { expireOpenAuctions } from '../lib/auction-lifecycle.mjs'

// Scheduled maintenance (Vercel Cron → vercel.json `crons`). Runs the periodic sweeps that USED to run
// lazily on hot read paths (search / overview / wallet), so those reads stay read-only and fast at scale.
// Also enforces audit-log retention (M2). Secured FAIL-CLOSED: it requires the CRON_SECRET bearer that
// Vercel injects as `Authorization: Bearer <CRON_SECRET>` on every cron invocation once the env var is set.
// If CRON_SECRET is NOT configured the endpoint is disabled (401) rather than falling back to the
// x-vercel-cron header — that header is client-settable, so trusting it would let anyone trigger the
// sweeps / audit-log deletion. The sweeps are best-effort (inline per-record sweeps still cover viewed
// listings), so a disabled cron only means staleness, never a security hole.

// Audit-log retention window. Default ~2 years; set AUDIT_LOG_RETENTION_DAYS=0 to keep everything forever
// (financial/compliance choice — the owner can raise this). Only deletes rows OLDER than the window.
const AUDIT_LOG_RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 730)

function unauthorized() {
  const error = new Error('This endpoint is not publicly accessible.')
  error.statusCode = 401
  error.code = 'CRON_UNAUTHORIZED'
  error.expose = true
  return error
}

export async function handleCron(req, res, url) {
  if (url.pathname !== '/api/cron/maintenance') return false

  // Fail-closed: the CRON_SECRET bearer is the ONLY accepted credential. No secret configured → the
  // endpoint is disabled (the x-vercel-cron header is client-settable and must never be trusted alone).
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) throw unauthorized()

  const results = {}
  const runStep = async (name, fn) => {
    try {
      results[name] = (await fn()) ?? 'ok'
    } catch (error) {
      results[name] = `error: ${error?.message || error}`
    }
  }

  await runStep('completedBookings', () => completeExpiredBookings())
  await runStep('expiredListings', () => expireOldListings())
  await runStep('expiredAuctions', () => expireOpenAuctions())
  await runStep('purgedListingMedia', async () => {
    await purgeStaleListingMedia()
    return 'ok'
  })

  if (AUDIT_LOG_RETENTION_DAYS > 0) {
    await runStep('auditLogPurged', async () => {
      const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      const purged = await db().adminAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
      return purged.count
    })
  }

  return json(res, 200, { ok: true, ranAt: new Date().toISOString(), results })
}
