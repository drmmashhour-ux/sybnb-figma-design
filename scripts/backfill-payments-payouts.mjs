// M5 coexistence — one-time backfill of pre-M5 settled STR bookings into the new Payment/Payout records.
//
// Reads ONLY frozen sources so it can never restate: the frozen booking_admin_share (commission) and
// booking_payout (host net) wallet entries, plus booking.metadata.settlement/termsSnapshot (M4). The
// accommodation/cleaning breakdown is reconstructed with bookingFinanceSplit — but that split's rent/
// cleaning derivation does NOT depend on the commission rate, and the commission AMOUNT is taken from the
// frozen wallet entry (not recomputed), so the record reproduces settlement-time figures exactly. Where a
// frozen rate/version is absent (pre-M4 legacy), baseVersion is marked 'legacy-unversioned' and the
// effective rate is derived from the frozen commission ÷ base — never invented.
//
// Idempotent: skips any booking that already has a Payment record. Safe to re-run.

import { db } from '../server/lib/prisma.mjs'
import { bookingFinanceSplit } from '../server/lib/finance-ledger.mjs'

export async function backfillPaymentsPayouts({ dryRun = false } = {}) {
  // "Settled" = has a frozen booking_admin_share/booking_payout wallet entry (a paid booking sits in
  // REQUESTED until the host confirms, so status alone is not the signal). Key off those entries.
  const settlementEntries = await db().walletEntry.findMany({
    where: { referenceType: { in: ['booking_admin_share', 'booking_payout'] } },
    select: { referenceId: true },
    distinct: ['referenceId'],
  })
  const settledBookingIds = [...new Set(settlementEntries.map((e) => e.referenceId))]
  const bookings = await db().booking.findMany({
    where: { id: { in: settledBookingIds }, listing: { division: 'STAYS' } },
    include: { listing: true },
  })
  const existing = new Set((await db().payment.findMany({ where: { bookingId: { in: bookings.map((b) => b.id) } }, select: { bookingId: true } })).map((p) => p.bookingId))

  let created = 0
  let skippedExisting = 0
  let skippedUnsettled = 0
  for (const booking of bookings) {
    if (existing.has(booking.id)) { skippedExisting++; continue }
    const meta = booking.metadata && typeof booking.metadata === 'object' ? booking.metadata : {}
    const [adminShare, payoutEntry, releaseEntry] = await Promise.all([
      db().walletEntry.findFirst({ where: { referenceType: 'booking_admin_share', referenceId: booking.id, type: 'CREDIT' } }),
      db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id, type: { in: ['HOLD', 'RELEASE'] } }, orderBy: { createdAt: 'asc' } }),
      db().walletEntry.findFirst({ where: { referenceType: 'booking_payout', referenceId: booking.id, type: 'RELEASE' } }),
    ])
    if (!adminShare && !payoutEntry) { skippedUnsettled++; continue } // never actually settled → nothing frozen to carry

    const frozenRate = typeof meta.termsSnapshot?.commissionRate === 'number' ? meta.termsSnapshot.commissionRate : null
    const baseVersion = meta.termsSnapshot?.baseVersion || 'legacy-unversioned'
    const grossMinor = Number.isFinite(meta.settlement?.chargedAmountMinor) ? meta.settlement.chargedAmountMinor : booking.amountMinor
    // rent/cleaning derivation is rate-independent; pass the frozen rate when we have it for completeness.
    const split = bookingFinanceSplit(booking, grossMinor, frozenRate ?? undefined)
    const commissionBaseMinor = split.stayAmountMinor + split.cleaningFeeMinor
    const commissionAmountMinor = adminShare?.amountMinor ?? split.adminShareMinor
    const hostNet = payoutEntry?.amountMinor ?? split.hostGrossMinor
    const commissionRateParts = frozenRate != null
      ? Math.round(frozenRate * 1_000_000)
      : (commissionBaseMinor > 0 ? Math.round((commissionAmountMinor / commissionBaseMinor) * 1_000_000) : 0)

    if (dryRun) { created++; continue }
    await db().$transaction(async (tx) => {
      await tx.payment.create({ data: {
        bookingId: booking.id,
        grossMinor,
        accommodationMinor: split.stayAmountMinor,
        cleaningFeeMinor: split.cleaningFeeMinor,
        extraFeesMinor: split.extraFeesMinor,
        processingFeeMinor: Math.max(0, split.hostGrossMinor - hostNet),
        commissionBaseMinor,
        commissionRateParts,
        commissionAmountMinor,
        hostPayoutMinor: split.hostGrossMinor,
        taxComponents: [],
        taxTotalMinor: 0,
        currency: booking.currency,
        settlementRef: meta.settlement?.settlementRef || booking.id,
        baseVersion,
        status: 'SETTLED',
        source: 'backfill',
      } })
      await tx.payout.create({ data: {
        bookingId: booking.id,
        hostId: booking.listing.ownerId,
        amountMinor: hostNet,
        currency: booking.currency,
        status: releaseEntry ? 'RELEASED' : 'PENDING_HOLD',
        releaseDate: releaseEntry?.createdAt ?? null,
        source: 'backfill',
      } })
    })
    created++
  }
  return { scanned: bookings.length, created, skippedExisting, skippedUnsettled }
}

// CLI entry: `node scripts/backfill-payments-payouts.mjs [--dry-run]`
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillPaymentsPayouts({ dryRun: process.argv.includes('--dry-run') })
    .then((r) => { console.log(JSON.stringify(r)); process.exit(0) })
    .catch((e) => { console.error(e); process.exit(1) })
}
