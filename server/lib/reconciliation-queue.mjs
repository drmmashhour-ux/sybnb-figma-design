// Fix E, Slice 3 — surface reconciliation state for admin action. Read-only: it never changes a record.
// A payment needs attention when a payout is staged for it (money in hold/eligible/released, i.e. not
// reversed) and there is no MATCHED received-funds record. Each such payment is classified from its LATEST
// reconciliation attempt: MISMATCH (with reason) if the last attempt mismatched, else UNRECONCILED (no
// attempt yet). Fully MATCHED payments are excluded. Fields are amounts/refs/status only — no PII.

const STAGED_PAYOUT_STATUSES = ['PENDING_HOLD', 'ELIGIBLE', 'RELEASED']

export async function compileReconciliationQueue(db) {
  const [payouts, reconciliations] = await Promise.all([
    db.payout.findMany({ where: { status: { in: STAGED_PAYOUT_STATUSES } }, select: { bookingId: true } }),
    // Newest first, so the first row seen per booking is its latest attempt.
    db.reconciliationRecord.findMany({ orderBy: { createdAt: 'desc' }, select: { bookingId: true, status: true, mismatchReason: true } }),
  ])

  const latestByBooking = new Map()
  const matchedBookings = new Set()
  for (const r of reconciliations) {
    if (r.status === 'MATCHED') matchedBookings.add(r.bookingId)
    if (!latestByBooking.has(r.bookingId)) latestByBooking.set(r.bookingId, r)
  }

  const eligibleBookingIds = [...new Set(payouts.map((p) => p.bookingId))].filter((id) => !matchedBookings.has(id))
  const payments = eligibleBookingIds.length
    ? await db.payment.findMany({ where: { bookingId: { in: eligibleBookingIds } }, select: { bookingId: true, grossMinor: true, currency: true, settlementRef: true } })
    : []

  const items = payments.map((p) => {
    const latest = latestByBooking.get(p.bookingId)
    const isMismatch = latest?.status === 'MISMATCH'
    return {
      bookingId: p.bookingId,
      amountMinor: p.grossMinor,
      currency: p.currency,
      settlementRef: p.settlementRef,
      status: isMismatch ? 'MISMATCH' : 'UNRECONCILED',
      reason: isMismatch ? latest.mismatchReason : null,
    }
  })

  return {
    items,
    mismatchCount: items.filter((i) => i.status === 'MISMATCH').length,
    unreconciledCount: items.filter((i) => i.status === 'UNRECONCILED').length,
  }
}
