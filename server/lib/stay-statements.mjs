import { bookingFinanceSplit, makeStrCommissionRateResolver } from './finance-ledger.mjs'

// Tax-compliance foundation (029) — Stay "Host Earnings and Tax Statement". Lodging tax/GST/QST are
// read from the settlement's own WalletEntry.metadata (stamped at approval time, see
// approvePaymentProof in finance-ledger.mjs) -- never recomputed, so they can't drift if a rule
// changes later. The non-tax breakdown (rent/cleaning/commission split) is recomputed live via
// bookingFinanceSplit against the booking + listing's CURRENT data, same as every other admin
// display in this codebase already does (AdminReviewPage's FeeLine panels) -- a real but pre-existing
// limitation (a listing metadata edit after the fact could shift this), not something this statement
// module introduces or claims to fix.

const ZERO_TOTALS = {
  grossBookingMinor: 0, nightlyAccommodationMinor: 0, cleaningFeeMinor: 0, extraFeesMinor: 0,
  lodgingTaxMinor: 0, gstMinor: 0, qstMinor: 0, commissionMinor: 0, paymentProcessingFeeMinor: 0,
  refundedMinor: 0, netHostPayoutMinor: 0, taxesCollectedBySybnbMinor: 0, taxesHostResponsibilityMinor: 0,
}

export async function buildStayStatement(db, { hostId, periodType, periodStart, periodEnd }) {
  const hostWallets = await db.wallet.findMany({ where: { userId: hostId }, select: { id: true, currency: true } })
  const walletIds = hostWallets.map((w) => w.id)

  const base = {
    hostId, periodType, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(),
    currency: hostWallets[0]?.currency || 'SYP', lineCount: 0, lines: [], totals: { ...ZERO_TOTALS },
    generatedAt: new Date().toISOString(),
  }
  if (!walletIds.length) return base

  const entries = await db.walletEntry.findMany({
    where: { walletId: { in: walletIds }, referenceType: 'booking_payout', createdAt: { gte: periodStart, lt: periodEnd } },
    orderBy: { createdAt: 'asc' },
  })
  if (!entries.length) return base

  const bookingIds = [...new Set(entries.map((e) => e.referenceId))]
  const bookings = await db.booking.findMany({ where: { id: { in: bookingIds } }, include: { listing: true } })
  const bookingById = new Map(bookings.map((b) => [b.id, b]))

  const adminShareEntries = await db.walletEntry.findMany({ where: { referenceType: 'booking_admin_share', referenceId: { in: bookingIds } } })
  const adminShareByBooking = new Map()
  for (const e of adminShareEntries) adminShareByBooking.set(e.referenceId, (adminShareByBooking.get(e.referenceId) || 0) + e.amountMinor)

  const refunds = await db.dispute.findMany({ where: { bookingId: { in: bookingIds }, status: 'RESOLVED_REFUNDED' } })
  const refundByBooking = new Map(refunds.map((d) => [d.bookingId, d.refundMinor || 0]))

  // M5: render each line from the FROZEN Payment record (never a live recompute) so an issued booking
  // keeps its terms even if the commission policy rate later changes — this is what closes the M2
  // retroactive-restatement gap. The backfill (scripts/backfill-payments-payouts.mjs) guarantees a record
  // for every settled booking; the bookingFinanceSplit branch below is only a pre-backfill safety net and
  // is flagged (source: 'recomputed') so a restatement can never be silent.
  const paymentRecords = await db.payment.findMany({ where: { bookingId: { in: bookingIds } } })
  const paymentByBooking = new Map(paymentRecords.map((p) => [p.bookingId, p]))
  const rateFor = makeStrCommissionRateResolver(db)

  const lines = (await Promise.all(entries.map(async (entry) => {
    const booking = bookingById.get(entry.referenceId)
    if (!booking) return null
    const frozen = paymentByBooking.get(booking.id)
    const split = frozen ? null : bookingFinanceSplit(booking, booking.amountMinor, await rateFor(booking))
    const source = frozen ? frozen.source : 'recomputed'
    const nightlyAccommodationMinor = frozen ? frozen.accommodationMinor : split.stayAmountMinor
    const cleaningFeeMinor = frozen ? frozen.cleaningFeeMinor : split.cleaningFeeMinor
    const extraFeesMinor = frozen ? frozen.extraFeesMinor : split.extraFeesMinor
    const grossBookingMinor = frozen ? frozen.grossMinor : split.paidTotalMinor
    // Commission stays sourced from the frozen record; the booking_admin_share wallet entry is the
    // legacy fallback for the recomputed path only.
    const commissionMinor = frozen ? frozen.commissionAmountMinor : (adminShareByBooking.get(booking.id) || split.adminShareMinor)
    const paymentProcessingFeeMinor = frozen ? frozen.processingFeeMinor : Math.max(0, split.hostGrossMinor - entry.amountMinor)
    const nights = booking.checkIn && booking.checkOut
      ? Math.max(1, Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000))
      : null
    const quebecTax = entry.metadata && entry.metadata.taxRegime === 'quebec_stay_v1' ? entry.metadata : null
    const lodgingTaxMinor = quebecTax?.lodgingTaxMinor || 0
    const gstMinor = quebecTax?.gstMinor || 0
    const qstMinor = quebecTax?.qstMinor || 0
    // Lodging tax is always platform-collected/reported (Revenu Québec's digital-platform rule).
    // GST/QST split by the host's own explicit tax-treatment decision (never inferred) -- see
    // resolveGstQstResponsibility in quebec-stay-tax.mjs.
    const gstQstCollected = quebecTax?.gstQstCollectedBySybnb ? gstMinor + qstMinor : 0
    const gstQstHostResponsibility = quebecTax && !quebecTax.gstQstCollectedBySybnb ? gstMinor + qstMinor : 0

    return {
      bookingId: booking.id,
      date: entry.createdAt,
      currency: entry.currency,
      nights,
      nightlyAccommodationMinor,
      cleaningFeeMinor,
      extraFeesMinor,
      grossBookingMinor,
      lodgingTaxMinor,
      gstMinor,
      qstMinor,
      gstQstResponsibility: quebecTax?.gstQstResponsibility || null,
      gstQstCollectedBySybnb: quebecTax?.gstQstCollectedBySybnb || false,
      commissionMinor,
      paymentProcessingFeeMinor,
      refundedMinor: refundByBooking.get(booking.id) || 0,
      netHostPayoutMinor: entry.amountMinor,
      taxesCollectedBySybnbMinor: lodgingTaxMinor + gstQstCollected,
      taxesHostResponsibilityMinor: gstQstHostResponsibility,
      source,
    }
  }))).filter(Boolean)

  const totals = lines.reduce((acc, l) => ({
    grossBookingMinor: acc.grossBookingMinor + l.grossBookingMinor,
    nightlyAccommodationMinor: acc.nightlyAccommodationMinor + l.nightlyAccommodationMinor,
    cleaningFeeMinor: acc.cleaningFeeMinor + l.cleaningFeeMinor,
    extraFeesMinor: acc.extraFeesMinor + l.extraFeesMinor,
    lodgingTaxMinor: acc.lodgingTaxMinor + l.lodgingTaxMinor,
    gstMinor: acc.gstMinor + l.gstMinor,
    qstMinor: acc.qstMinor + l.qstMinor,
    commissionMinor: acc.commissionMinor + l.commissionMinor,
    paymentProcessingFeeMinor: acc.paymentProcessingFeeMinor + l.paymentProcessingFeeMinor,
    refundedMinor: acc.refundedMinor + l.refundedMinor,
    netHostPayoutMinor: acc.netHostPayoutMinor + l.netHostPayoutMinor,
    taxesCollectedBySybnbMinor: acc.taxesCollectedBySybnbMinor + l.taxesCollectedBySybnbMinor,
    taxesHostResponsibilityMinor: acc.taxesHostResponsibilityMinor + l.taxesHostResponsibilityMinor,
  }), { ...ZERO_TOTALS })

  return { ...base, lineCount: lines.length, lines, totals }
}

const DISCLAIMER = {
  en: 'SYBNB-generated information statement. This is not a T4, RL-1, T4A or other employment slip and does not replace professional tax advice.',
  fr: "Relevé d'information généré par SYBNB. Il ne s'agit pas d'un T4, d'un RL-1, d'un T4A ni d'un autre feuillet d'emploi et il ne remplace pas les conseils d'un professionnel de la fiscalité.",
}

function money(minor, currency) {
  return `${Math.round(minor || 0).toLocaleString('en-US')} ${currency}`
}

export function renderStayStatementDocument(statement, { lang = 'en', hostName = '' } = {}) {
  const t = lang === 'fr'
    ? {
        title: "Relevé des revenus et fiscal de l'hôte",
        period: 'Période', from: 'Du', to: 'Au', host: 'Hôte', bookings: 'Réservations',
        gross: 'Montant brut de la réservation', accommodation: "Prix d'hébergement (par nuitée x nuitées)",
        cleaning: 'Frais de ménage et services additionnels', lodging: 'Taxe sur l\'hébergement du Québec (3,5%)',
        gst: 'TPS', qst: 'TVQ', commission: 'Commission SYBNB', processing: 'Frais de traitement des paiements',
        refunds: 'Remboursements et ajustements', collected: 'Taxes perçues/remises par SYBNB',
        hostResponsibility: "Taxes restant à la charge de l'hôte", net: "Versement net à l'hôte",
      }
    : {
        title: 'Host Earnings and Tax Statement',
        period: 'Period', from: 'From', to: 'To', host: 'Host', bookings: 'Bookings',
        gross: 'Gross booking amount', accommodation: 'Nightly accommodation price (per-night x nights)',
        cleaning: 'Cleaning and additional service charges', lodging: 'Québec lodging tax (3.5%)',
        gst: 'GST', qst: 'QST', commission: 'SYBNB commission', processing: 'Payment-processing charges',
        refunds: 'Refunds and adjustments', collected: 'Taxes collected/remitted by SYBNB',
        hostResponsibility: "Taxes remaining the host's responsibility", net: 'Net host payout',
      }

  const c = statement.currency
  const lines = [
    t.title,
    hostName ? `${t.host}: ${hostName}` : '',
    `${t.period}: ${statement.periodType}`,
    `${t.from}: ${statement.periodStart.slice(0, 10)}  ${t.to}: ${statement.periodEnd.slice(0, 10)}`,
    '',
    `${t.bookings}: ${statement.lineCount}`,
    `${t.gross}: ${money(statement.totals.grossBookingMinor, c)}`,
    `${t.accommodation}: ${money(statement.totals.nightlyAccommodationMinor, c)}`,
    `${t.cleaning}: ${money(statement.totals.cleaningFeeMinor + statement.totals.extraFeesMinor, c)}`,
    `${t.lodging}: ${money(statement.totals.lodgingTaxMinor, c)}`,
    `${t.gst}: ${money(statement.totals.gstMinor, c)}`,
    `${t.qst}: ${money(statement.totals.qstMinor, c)}`,
    `${t.commission}: ${money(statement.totals.commissionMinor, c)}`,
    `${t.processing}: ${money(statement.totals.paymentProcessingFeeMinor, c)}`,
    `${t.refunds}: ${money(statement.totals.refundedMinor, c)}`,
    `${t.collected}: ${money(statement.totals.taxesCollectedBySybnbMinor, c)}`,
    `${t.hostResponsibility}: ${money(statement.totals.taxesHostResponsibilityMinor, c)}`,
    `${t.net}: ${money(statement.totals.netHostPayoutMinor, c)}`,
    '',
    DISCLAIMER[lang] || DISCLAIMER.en,
  ]
  return lines.join('\n')
}
