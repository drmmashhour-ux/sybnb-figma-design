// Tax-compliance foundation (029) — SR "Driver Earnings and Tax Statement". Reads exclusively from
// the wallet ledger, never recomputes the commission: sr-payments.mjs's chargeCompletedRide already
// stored the exact tier breakdown that applied on each settlement (WalletEntry.metadata). This module
// only aggregates and formats what already happened -- it can never disagree with the ledger, and a
// later change to SR_COMMISSION_TIERS can never retroactively change a past statement's numbers.

const ZERO_TOTALS = {
  grossFareMinor: 0,
  commissionMinor: 0,
  tipMinor: 0,
  cancellationCompensationMinor: 0,
  netPayoutMinor: 0,
  gstCollectedMinor: 0,
  qstCollectedMinor: 0,
  quebecRideContributionMinor: 0,
  refundedMinor: 0,
  // Included here (not just added on the non-empty path below) so a statement with zero activity
  // has the exact same totals shape as one with activity -- a caller destructuring
  // totals.remittedToRevenuQuebecMinor should never see undefined just because nothing happened yet.
  remittedToRevenuQuebecMinor: 0,
}

// Builds one driver's ride statement for [periodStart, periodEnd). periodType is a label only
// ('TRANSACTION' | 'MONTHLY' | 'PERIOD' | 'ANNUAL') -- the query itself is always the same date-range
// aggregation; callers pick the boundaries that match the label (see resolveStatementPeriod).
export async function buildRideStatement(db, { driverId, periodType, periodStart, periodEnd, rideGovernmentRemittanceActive = false }) {
  const driverWallets = await db.wallet.findMany({ where: { userId: driverId }, select: { id: true, currency: true } })
  const walletIds = driverWallets.map((w) => w.id)

  const base = {
    driverId, periodType, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(),
    currency: driverWallets[0]?.currency || 'SYP', lineCount: 0, lines: [], totals: { ...ZERO_TOTALS },
    rideGovernmentRemittanceActive, generatedAt: new Date().toISOString(),
  }
  if (!walletIds.length) return base

  const entries = await db.walletEntry.findMany({
    where: {
      walletId: { in: walletIds },
      referenceType: { in: ['sr_driver_earning', 'sr_driver_tip', 'sr_cancellation_payout'] },
      createdAt: { gte: periodStart, lt: periodEnd },
    },
    orderBy: { createdAt: 'asc' },
  })
  if (!entries.length) return base

  const rideIds = [...new Set(entries.map((e) => e.referenceId))]
  const rides = await db.rideRequest.findMany({ where: { id: { in: rideIds } } })
  const rideById = new Map(rides.map((r) => [r.id, r]))

  const refunds = await db.dispute.findMany({ where: { rideId: { in: rideIds }, status: 'RESOLVED_REFUNDED' } })
  const refundByRide = new Map(refunds.map((d) => [d.rideId, d.refundMinor || 0]))

  const lineByRide = new Map()
  for (const entry of entries) {
    const ride = rideById.get(entry.referenceId)
    if (!ride) continue
    if (!lineByRide.has(ride.id)) {
      lineByRide.set(ride.id, {
        rideId: ride.id,
        date: ride.updatedAt,
        currency: ride.currency,
        grossFareMinor: ride.fareMinor || 0,
        driverEarningMinor: 0,
        tipMinor: 0,
        cancellationCompensationMinor: 0,
        commissionBreakdown: null,
        gstCollectedMinor: 0,
        qstCollectedMinor: 0,
        quebecRideContributionMinor: 0,
        refundedMinor: refundByRide.get(ride.id) || 0,
      })
    }
    const line = lineByRide.get(ride.id)
    if (entry.referenceType === 'sr_driver_earning') {
      line.driverEarningMinor += entry.amountMinor
      line.commissionBreakdown = entry.metadata && Object.keys(entry.metadata).length ? entry.metadata : null
      // Quebec-specific taxes: always 0 today, since Quebec SR isn't live (geofenced to Syria --
      // resolveDriverJurisdiction in jurisdiction-compliance.mjs). Read from the settlement's own
      // metadata (never a live recompute) so the day a Quebec ride settlement DOES stamp these, the
      // statement reflects exactly what that settlement recorded, not today's rules.
      line.gstCollectedMinor = entry.metadata?.gstCollectedMinor || 0
      line.qstCollectedMinor = entry.metadata?.qstCollectedMinor || 0
      line.quebecRideContributionMinor = entry.metadata?.quebecRideContributionMinor || 0
    } else if (entry.referenceType === 'sr_driver_tip') {
      line.tipMinor += entry.amountMinor
    } else if (entry.referenceType === 'sr_cancellation_payout') {
      line.cancellationCompensationMinor += entry.amountMinor
    }
  }

  const lines = Array.from(lineByRide.values())
    .map((line) => ({
      ...line,
      commissionMinor: Math.max(0, line.grossFareMinor - line.driverEarningMinor),
      netPayoutMinor: line.driverEarningMinor + line.tipMinor + line.cancellationCompensationMinor,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const totals = lines.reduce((acc, l) => ({
    grossFareMinor: acc.grossFareMinor + l.grossFareMinor,
    commissionMinor: acc.commissionMinor + l.commissionMinor,
    tipMinor: acc.tipMinor + l.tipMinor,
    cancellationCompensationMinor: acc.cancellationCompensationMinor + l.cancellationCompensationMinor,
    netPayoutMinor: acc.netPayoutMinor + l.netPayoutMinor,
    gstCollectedMinor: acc.gstCollectedMinor + l.gstCollectedMinor,
    qstCollectedMinor: acc.qstCollectedMinor + l.qstCollectedMinor,
    quebecRideContributionMinor: acc.quebecRideContributionMinor + l.quebecRideContributionMinor,
    refundedMinor: acc.refundedMinor + l.refundedMinor,
  }), { ...ZERO_TOTALS })

  // "Amounts remitted to Revenu Québec in the driver's name" -- distinct from "collected". Collection
  // happens at settlement (the gst/qst/contribution fields above); remittance is a separate downstream
  // regulatory act that must never be claimed to have happened while RIDE_GOVERNMENT_REMITTANCE_ACTIVE is
  // inactive (server/lib/compliance-feature-flags.mjs). rideGovernmentRemittanceActive is caller-supplied, not
  // read internally, so this module stays testable without needing the flag system wired up.
  const remittedMinor = rideGovernmentRemittanceActive
    ? totals.gstCollectedMinor + totals.qstCollectedMinor + totals.quebecRideContributionMinor
    : 0

  return { ...base, lineCount: lines.length, lines, totals: { ...totals, remittedToRevenuQuebecMinor: remittedMinor } }
}

// Calendar-boundary helper for the four statement cadences the spec asks for. All boundaries are UTC
// (matches the rest of this codebase's calendar-year/day conventions, e.g. sr-payments.mjs's YTD calc).
export function resolveStatementPeriod(periodType, { year, month, quarter } = {}) {
  const y = year || new Date().getUTCFullYear()
  if (periodType === 'ANNUAL') {
    return { periodStart: new Date(Date.UTC(y, 0, 1)), periodEnd: new Date(Date.UTC(y + 1, 0, 1)) }
  }
  if (periodType === 'MONTHLY') {
    const m = Number.isInteger(month) ? month : new Date().getUTCMonth() + 1
    return { periodStart: new Date(Date.UTC(y, m - 1, 1)), periodEnd: new Date(Date.UTC(y, m, 1)) }
  }
  if (periodType === 'PERIOD' && Number.isInteger(quarter)) {
    const startMonth = (quarter - 1) * 3
    return { periodStart: new Date(Date.UTC(y, startMonth, 1)), periodEnd: new Date(Date.UTC(y, startMonth + 3, 1)) }
  }
  const error = new Error('periodType must be MONTHLY, PERIOD (with quarter), or ANNUAL for a resolved date range; pass explicit periodStart/periodEnd for TRANSACTION statements.')
  error.statusCode = 400
  error.code = 'STATEMENT_PERIOD_INVALID'
  error.expose = true
  throw error
}

const DISCLAIMER = {
  en: 'SYBNB-generated information statement. This is not a T4, RL-1, T4A or other employment slip and does not replace professional tax advice.',
  fr: "Relevé d'information généré par SYBNB. Il ne s'agit pas d'un T4, d'un RL-1, d'un T4A ni d'un autre feuillet d'emploi et il ne remplace pas les conseils d'un professionnel de la fiscalité.",
}

// amountMinor is a WHOLE currency unit in this codebase, not cents (see currency.mjs / moneyText in
// src/shared/i18n/display.ts) -- a 24,000 SYP fare is stored and displayed as 24000, not 240.00.
function money(minor, currency) {
  return `${Math.round(minor || 0).toLocaleString('en-US')} ${currency}`
}

// "Driver Earnings and Tax Statement" -- the human-readable document. English and French only (per
// the task); JSON via buildRideStatement is the machine-readable form the same data always comes from.
export function renderRideStatementDocument(statement, { lang = 'en', driverName = '' } = {}) {
  const t = lang === 'fr'
    ? {
        title: 'Relevé des revenus et fiscal du conducteur',
        period: 'Période', from: 'Du', to: 'Au', driver: 'Conducteur',
        grossFare: 'Tarifs bruts de transport de passagers', gst: 'TPS perçue au nom du conducteur',
        qst: 'TVQ perçue au nom du conducteur', contribution: 'Contribution obligatoire perçue (Québec)',
        commission: 'Commission SYBNB', tips: 'Pourboires', cancellation: 'Indemnité d\'annulation/de présentation',
        refunds: 'Remboursements et ajustements', remitted: 'Montants remis à Revenu Québec au nom du conducteur',
        netPayout: 'Versement net au conducteur', rides: 'Courses',
      }
    : {
        title: 'Driver Earnings and Tax Statement',
        period: 'Period', from: 'From', to: 'To', driver: 'Driver',
        grossFare: 'Gross passenger transportation fares', gst: "GST collected in the driver's name",
        qst: "QST collected in the driver's name", contribution: 'Québec mandatory ride contribution collected',
        commission: 'SYBNB commission', tips: 'Tips', cancellation: 'Cancellation / show-up compensation',
        refunds: 'Refunds and adjustments', remitted: "Amounts remitted to Revenu Québec in the driver's name",
        netPayout: 'Net payout to driver', rides: 'Rides',
      }

  const c = statement.currency
  const lines = [
    `${t.title}`,
    driverName ? `${t.driver}: ${driverName}` : '',
    `${t.period}: ${statement.periodType}`,
    `${t.from}: ${statement.periodStart.slice(0, 10)}  ${t.to}: ${statement.periodEnd.slice(0, 10)}`,
    '',
    `${t.rides}: ${statement.lineCount}`,
    `${t.grossFare}: ${money(statement.totals.grossFareMinor, c)}`,
    `${t.gst}: ${money(statement.totals.gstCollectedMinor, c)}`,
    `${t.qst}: ${money(statement.totals.qstCollectedMinor, c)}`,
    `${t.contribution}: ${money(statement.totals.quebecRideContributionMinor, c)}`,
    `${t.commission}: ${money(statement.totals.commissionMinor, c)}`,
    `${t.tips}: ${money(statement.totals.tipMinor, c)}`,
    `${t.cancellation}: ${money(statement.totals.cancellationCompensationMinor, c)}`,
    `${t.refunds}: ${money(statement.totals.refundedMinor, c)}`,
    `${t.remitted}: ${money(statement.totals.remittedToRevenuQuebecMinor || 0, c)}`,
    `${t.netPayout}: ${money(statement.totals.netPayoutMinor, c)}`,
    '',
    DISCLAIMER[lang] || DISCLAIMER.en,
  ]
  return lines.filter((l) => l !== '' || true).join('\n')
}

export { DISCLAIMER as STATEMENT_DISCLAIMER }
