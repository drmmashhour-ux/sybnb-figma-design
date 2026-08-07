import { db } from '../lib/prisma.mjs'
import { json } from '../lib/responses.mjs'
import { completeExpiredBookings } from '../lib/booking-lifecycle.mjs'
import { expireOldListings, purgeStaleListingMedia } from '../lib/listing-lifecycle.mjs'
import { expireOpenAuctions } from '../lib/auction-lifecycle.mjs'
import { purgeAssistantConfirmations } from '../lib/assistant-confirmations.mjs'
import { retryPendingStripeDisputeRefunds } from './disputes.mjs'
import { reconcileStripeCaptures } from './payments.mjs'
import { buildDailyExecutiveReport, formatDailyExecutiveReport } from './admin.mjs'
import { sendDailyAdminReportEmail } from '../lib/mailer.mjs'

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
const DAILY_REPORT_TIME_ZONE = 'America/Toronto'

function torontoReportClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_REPORT_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type) => parts.find((part) => part.type === type)?.value || ''
  return { date: `${value('year')}-${value('month')}-${value('day')}`, hour: Number(value('hour')) }
}

function unauthorized() {
  const error = new Error('This endpoint is not publicly accessible.')
  error.statusCode = 401
  error.code = 'CRON_UNAUTHORIZED'
  error.expose = true
  return error
}

export async function handleCron(req, res, url) {
  if (!['/api/cron/maintenance', '/api/cron/daily-report', '/api/cron/keep-alive'].includes(url.pathname)) return false

  // Fail-closed: the CRON_SECRET bearer is the ONLY accepted credential. No secret configured → the
  // endpoint is disabled (the x-vercel-cron header is client-settable and must never be trusted alone).
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) throw unauthorized()

  if (url.pathname === '/api/cron/keep-alive') {
    // A trivial query on a short interval prevents Neon compute autosuspend, so the first request after a
    // quiet period doesn't eat a multi-second cold-start. Cheap and read-only.
    await db().$queryRaw`SELECT 1`
    return json(res, 200, { ok: true, keptAlive: true, at: new Date().toISOString() })
  }

  if (url.pathname === '/api/cron/daily-report') {
    // Vercel cron schedules are UTC. It calls at both possible Toronto 08:00 UTC hours; this
    // timezone gate selects the correct one across daylight-saving changes. The audit lookup makes
    // retries idempotent, so one local calendar day can produce at most one owner email.
    const clock = torontoReportClock()
    if (clock.hour !== 8) return json(res, 200, { ok: true, skipped: true, reason: 'outside_toronto_report_hour' })
    const alreadySent = await db().adminAuditLog.findFirst({
      where: { action: 'AI_DAILY_REPORT_SENT', entityType: 'ai_report', entityId: clock.date },
      select: { createdAt: true },
    })
    if (alreadySent) return json(res, 200, { ok: true, skipped: true, reason: 'already_sent', sentAt: alreadySent.createdAt.toISOString() })
    const report = await buildDailyExecutiveReport()
    const recipient = process.env.ADMIN_DAILY_REPORT_EMAIL || 'info@sybnb.app'
    await sendDailyAdminReportEmail(recipient, formatDailyExecutiveReport(report))
    await db().adminAuditLog.create({ data: { action: 'AI_DAILY_REPORT_SENT', entityType: 'ai_report', entityId: clock.date, before: {}, after: { recipient, generatedAt: report.generatedAt, timeZone: DAILY_REPORT_TIME_ZONE } } })
    return json(res, 200, { ok: true, sentAt: new Date().toISOString(), recipient })
  }

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
  await runStep('purgedAssistantConfirmations', () => purgeAssistantConfirmations())
  await runStep('purgedVerificationCodes', async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const [email, phone] = await db().$transaction([
      db().emailVerificationCode.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      db().phoneVerificationCode.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ])
    return email.count + phone.count
  })
  await runStep('retriedStripeDisputeRefunds', () => retryPendingStripeDisputeRefunds())
  await runStep('reconciledStripeCaptures', () => reconcileStripeCaptures())

  if (AUDIT_LOG_RETENTION_DAYS > 0) {
    await runStep('auditLogPurged', async () => {
      const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      const purged = await db().adminAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
      return purged.count
    })
  }

  return json(res, 200, { ok: true, ranAt: new Date().toISOString(), results })
}
