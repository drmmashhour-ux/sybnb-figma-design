import { compileReconciliationQueue } from './reconciliation-queue.mjs'

// AD3 — the admin AI daily report. Every FIGURE is a real DB count/aggregate computed HERE (the data layer);
// the model is never asked to produce, estimate, or adjust a number. An optional AI layer may only PHRASE
// these already-computed facts (server/lib/ai-insights.mjs generateDailyReportMessage), exactly like the
// host pricing insight — "restate only these facts, never invent a number." The report is advisory and
// admin-reviewed; nothing here takes an action.

// Compiles the daily operating facts from the actual records. asOf defaults to now; the "new bookings"
// window is the preceding 24h. Returns only integers/counts that reconcile 1:1 to the underlying tables.
export async function compileAdminDailyReport(db, { asOf = new Date() } = {}) {
  const dayAgo = new Date(asOf.getTime() - 24 * 60 * 60 * 1000)
  const [newBookings, pendingListingReviews, pendingPaymentProofs, payoutHold, openDisputes, reconQueue] = await Promise.all([
    db.booking.count({ where: { createdAt: { gte: dayAgo } } }),
    db.listing.count({ where: { status: 'PENDING_REVIEW' } }),
    db.paymentProof.count({ where: { status: 'PENDING_ADMIN_REVIEW' } }),
    db.payout.aggregate({ where: { status: 'PENDING_HOLD' }, _count: { _all: true }, _sum: { amountMinor: true } }),
    db.dispute.count({ where: { status: 'OPEN' } }),
    // Fix E: so a received-funds mismatch (or a payout still awaiting reconciliation) can't sit unnoticed.
    compileReconciliationQueue(db),
  ])
  return {
    generatedAt: asOf.toISOString(),
    // Provenance marker: every number below is a real record count/sum, never a model estimate.
    source: 'records',
    facts: {
      newBookings24h: newBookings,
      pendingListingReviews,
      pendingPaymentProofs,
      pendingReviewsTotal: pendingListingReviews + pendingPaymentProofs,
      payoutsPendingHoldCount: payoutHold._count._all,
      payoutsPendingHoldMinor: payoutHold._sum.amountMinor || 0,
      openDisputes,
      reconciliationMismatches: reconQueue.mismatchCount,
      reconciliationUnreconciled: reconQueue.unreconciledCount,
    },
  }
}

// Deterministic fallback narrative — interpolates ONLY the real facts, so even without the AI configured the
// report reads naturally and its numbers are still the data-layer numbers (never invented).
export function dailyReportTemplateNarrative(facts, lang = 'en') {
  if (lang === 'ar') {
    return `${facts.newBookings24h} حجز جديد خلال 24 ساعة، ${facts.pendingReviewsTotal} عنصر بانتظار المراجعة، ` +
      `${facts.payoutsPendingHoldCount} دفعة قيد الحجز، و${facts.openDisputes} نزاع مفتوح. ` +
      `${facts.reconciliationMismatches} عدم تطابق في التسوية و${facts.reconciliationUnreconciled} دفعة بانتظار التسوية.`
  }
  return `${facts.newBookings24h} new bookings in the last 24h, ${facts.pendingReviewsTotal} items awaiting review, ` +
    `${facts.payoutsPendingHoldCount} payouts in hold, and ${facts.openDisputes} open disputes. ` +
    `${facts.reconciliationMismatches} reconciliation mismatches and ${facts.reconciliationUnreconciled} payouts awaiting reconciliation.`
}
