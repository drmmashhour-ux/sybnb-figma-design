// Tax-compliance foundation (029) — CRA Part XX (digital platform reporting) ledger.
//
// IMPORTANT, READ BEFORE TOUCHING THE XML/T619 FUNCTIONS BELOW: this module builds the ARCHITECTURE
// for Part XX reporting -- the aggregation, the status workflow, the correction workflow -- not a
// verified implementation of CRA's actual prescribed XML schema or T619 form. Neither this repo nor
// this session has access to the real CRA XSD or T619 field-level spec. buildPartXXXml/
// buildT619TransmissionRecord produce a STRUCTURALLY REASONABLE shape (the data CRA's own guidance
// says a Part XX return must contain) so the export pipeline exists end-to-end, but they are NOT
// validated against the real schema and MUST be reviewed against the actual CRA specification
// (https://www.canada.ca/en/revenue-agency/programs/about-canada-revenue-agency-cra/compliance/
// reporting-rules-digital-platforms/filing-information-returns.html) before ever being transmitted.
// Nothing in this module ever claims a real CRA acceptance -- filing.status only ever becomes
// ACCEPTED via recordCraResponse, which requires a human to paste in a real response; there is no
// code path that sets ACCEPTED automatically.

function fail(code, message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}

export function quarterBounds(year, quarter) {
  if (!Number.isInteger(year) || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    fail('PART_XX_PERIOD_INVALID', 'year and quarter (1-4) are required.')
  }
  const startMonth = (quarter - 1) * 3
  return { periodStart: new Date(Date.UTC(year, startMonth, 1)), periodEnd: new Date(Date.UTC(year, startMonth + 3, 1)) }
}

// SR: one row per driver who earned in the quarter. Gross consideration is the FULL fare (what the
// rider paid), not the driver's net -- Part XX asks for gross consideration paid or credited to the
// seller, platform fees separately. Reads the same sr_driver_earning ledger entries the driver
// statement reads (server/lib/ride-statements.mjs) -- same source of truth, different aggregation shape.
async function aggregateRideActivity(db, { periodStart, periodEnd }) {
  const entries = await db.walletEntry.findMany({
    where: { referenceType: 'sr_driver_earning', createdAt: { gte: periodStart, lt: periodEnd } },
    include: { wallet: { select: { userId: true, currency: true } } },
  })
  if (!entries.length) return []
  const rideIds = [...new Set(entries.map((e) => e.referenceId))]
  const rides = await db.rideRequest.findMany({ where: { id: { in: rideIds } } })
  const rideById = new Map(rides.map((r) => [r.id, r]))

  const byDriver = new Map()
  for (const entry of entries) {
    const ride = rideById.get(entry.referenceId)
    if (!ride) continue
    const sellerId = entry.wallet.userId
    if (!byDriver.has(sellerId)) {
      byDriver.set(sellerId, { sellerId, activityType: 'RIDE', grossConsiderationMinor: 0, currency: entry.currency, activityCount: 0, platformFeesMinor: 0, propertyAddress: null })
    }
    const row = byDriver.get(sellerId)
    row.grossConsiderationMinor += ride.fareMinor || 0
    row.platformFeesMinor += Math.max(0, (ride.fareMinor || 0) - entry.amountMinor)
    row.activityCount += 1
  }
  return Array.from(byDriver.values())
}

// STAYS: one row per host, gross consideration = the full booking amount (guest-paid), platform fees
// = the admin commission share. Property address is the concatenation of every distinct listing
// address the host had a booking on in the quarter -- Part XX requires an address per accommodation
// activity; concatenating keeps one record per (host, quarter) instead of one per listing, since
// PartXXRecord is keyed on (seller, activityType, year, quarter) not per-property.
async function aggregateStayActivity(db, { periodStart, periodEnd }) {
  const entries = await db.walletEntry.findMany({
    where: { referenceType: 'booking_admin_share', createdAt: { gte: periodStart, lt: periodEnd } },
    include: { wallet: { select: { userId: true, currency: true } } },
  })
  if (!entries.length) return []
  const bookingIds = [...new Set(entries.map((e) => e.referenceId))]
  const bookings = await db.booking.findMany({ where: { id: { in: bookingIds } }, include: { listing: true } })
  const bookingById = new Map(bookings.map((b) => [b.id, b]))

  const byHost = new Map()
  for (const entry of entries) {
    const booking = bookingById.get(entry.referenceId)
    if (!booking?.listing) continue
    const sellerId = booking.listing.ownerId
    if (!byHost.has(sellerId)) {
      byHost.set(sellerId, { sellerId, activityType: 'ACCOMMODATION', grossConsiderationMinor: 0, currency: entry.currency, activityCount: 0, platformFeesMinor: 0, addresses: new Set() })
    }
    const row = byHost.get(sellerId)
    row.grossConsiderationMinor += booking.amountMinor || 0
    row.platformFeesMinor += entry.amountMinor
    row.activityCount += 1
    const meta = booking.listing.metadata || {}
    const address = [meta.addressLine1, meta.area, meta.city].filter(Boolean).join(', ') || null
    if (address) row.addresses.add(address)
  }
  return Array.from(byHost.values()).map(({ addresses, ...row }) => ({ ...row, propertyAddress: Array.from(addresses).join('; ') || null }))
}

// Upserts PartXXRecord rows for (year, quarter) from the ledger. NEVER overwrites a record that has
// moved past DRAFT (VALIDATED/FILED/ACCEPTED/REJECTED/CORRECTED) -- once a record is part of a real
// filing workflow it is frozen; the correction workflow (createCorrectionFiling below) is the only
// way to revise it. This is what makes "never recalculate historical statements" true for Part XX,
// not just for the per-driver/per-host statements.
export async function generatePartXXRecords(db, { year, quarter }) {
  const { periodStart, periodEnd } = quarterBounds(year, quarter)
  const rows = [...(await aggregateRideActivity(db, { periodStart, periodEnd })), ...(await aggregateStayActivity(db, { periodStart, periodEnd }))]

  const results = []
  for (const row of rows) {
    const key = { sellerId_activityType_year_quarter: { sellerId: row.sellerId, activityType: row.activityType, year, quarter } }
    const existing = await db.partXXRecord.findUnique({ where: key })
    if (existing && existing.status !== 'DRAFT') {
      results.push({ ...existing, skipped: true, skipReason: 'not_draft' })
      continue
    }
    const data = {
      grossConsiderationMinor: row.grossConsiderationMinor,
      currency: row.currency,
      activityCount: row.activityCount,
      platformFeesMinor: row.platformFeesMinor,
      propertyAddress: row.propertyAddress || null,
    }
    const record = await db.partXXRecord.upsert({
      where: key,
      create: { sellerId: row.sellerId, activityType: row.activityType, year, quarter, ...data },
      update: data,
    })
    results.push(record)
  }
  return results
}

// A record is filing-ready only if its seller has a VERIFIED tax profile carrying an identifier --
// Part XX explicitly requires "verified TIN information." A record whose seller has no profile, or
// an unverified one, fails validation and blocks the filing from advancing past DRAFT.
export async function validatePartXXRecords(db, records) {
  const errors = []
  for (const r of records) {
    const subjectType = r.activityType === 'RIDE' ? 'DRIVER' : 'HOST'
    const taxProfile = await db.taxProfile.findUnique({ where: { userId_subjectType: { userId: r.sellerId, subjectType } } })
    if (!taxProfile) {
      errors.push({ recordId: r.id, sellerId: r.sellerId, code: 'TAX_PROFILE_MISSING' })
    } else if (taxProfile.verificationStatus !== 'APPROVED') {
      errors.push({ recordId: r.id, sellerId: r.sellerId, code: 'TAX_PROFILE_NOT_VERIFIED' })
    }
    if (r.activityType === 'ACCOMMODATION' && !r.propertyAddress) {
      errors.push({ recordId: r.id, sellerId: r.sellerId, code: 'PROPERTY_ADDRESS_MISSING' })
    }
  }
  return { valid: errors.length === 0, errors }
}

// ---- Filing status workflow: DRAFT -> VALIDATED -> FILED -> ACCEPTED | REJECTED, or CORRECTED ----

export async function createDraftFiling(db, { year, quarter }) {
  const records = await db.partXXRecord.findMany({ where: { year, quarter, status: 'DRAFT' } })
  if (!records.length) fail('PART_XX_NO_DRAFT_RECORDS', `No DRAFT Part XX records exist for ${year} Q${quarter}. Run generatePartXXRecords first.`, 409)
  return db.$transaction(async (tx) => {
    const filing = await tx.partXXFiling.create({ data: { year, quarter, status: 'DRAFT' } })
    await tx.partXXRecord.updateMany({ where: { id: { in: records.map((r) => r.id) } }, data: { filingId: filing.id } })
    return filing
  })
}

export async function validateFiling(db, filingId) {
  const filing = await db.partXXFiling.findUnique({ where: { id: filingId }, include: { records: true } })
  if (!filing) fail('PART_XX_FILING_NOT_FOUND', 'Filing not found.', 404)
  const { valid, errors } = await validatePartXXRecords(db, filing.records)
  return db.partXXFiling.update({
    where: { id: filingId },
    data: valid ? { status: 'VALIDATED', errorDetails: null } : { errorDetails: { errors } },
  })
}

function xmlEscape(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// See the file-header notice: structural shape only, not the verified CRA XSD.
export function buildPartXXXml(records, { year, quarter, transmitterName = 'SYBNB' } = {}) {
  const body = records.map((r) => `
    <ReportedSeller>
      <SellerId>${xmlEscape(r.sellerId)}</SellerId>
      <ActivityType>${xmlEscape(r.activityType)}</ActivityType>
      <GrossConsiderationMinor>${r.grossConsiderationMinor}</GrossConsiderationMinor>
      <Currency>${xmlEscape(r.currency)}</Currency>
      <ActivityCount>${r.activityCount}</ActivityCount>
      <PlatformFeesMinor>${r.platformFeesMinor}</PlatformFeesMinor>
      <TaxesWithheldMinor>${r.taxesWithheldMinor || 0}</TaxesWithheldMinor>
      <RefundsMinor>${r.refundsMinor || 0}</RefundsMinor>${r.propertyAddress ? `\n      <PropertyAddress>${xmlEscape(r.propertyAddress)}</PropertyAddress>` : ''}
    </ReportedSeller>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- UNVALIDATED TEST EXPORT -- structural shape only, not verified against the real CRA XSD. Do not transmit. -->\n<PartXXInformationReturn year="${year}" quarter="${quarter}" transmitter="${xmlEscape(transmitterName)}" exportStatus="UNVALIDATED_TEST_EXPORT">${body}\n</PartXXInformationReturn>\n`
}

// See the file-header notice: structural shape only, not the verified CRA T619 field spec.
export function buildT619TransmissionRecord({ filingId, year, quarter, recordCount, transmitterName = 'SYBNB' }) {
  return {
    formType: 'T619_STRUCTURAL_PLACEHOLDER',
    exportStatus: 'UNVALIDATED_TEST_EXPORT',
    transmitterName,
    taxationYear: year,
    quarter,
    filingId,
    numberOfRecords: recordCount,
    transmissionRef: `SYBNB-${year}Q${quarter}-${filingId.slice(0, 8)}`,
  }
}

// Moves a VALIDATED filing to FILED and snapshots exactly what was (or would be) transmitted --
// submittedXml is never regenerated or edited after this point, by anyone, for any reason. This is
// the "immutable copy of exactly what was reported" the spec requires.
export async function markFiled(db, filingId, { actorId }) {
  const filing = await db.partXXFiling.findUnique({ where: { id: filingId }, include: { records: true } })
  if (!filing) fail('PART_XX_FILING_NOT_FOUND', 'Filing not found.', 404)
  if (filing.status !== 'VALIDATED') fail('PART_XX_FILING_NOT_VALIDATED', 'Only a VALIDATED filing can be marked FILED.', 409)

  const xml = buildPartXXXml(filing.records, { year: filing.year, quarter: filing.quarter })
  const t619 = buildT619TransmissionRecord({ filingId: filing.id, year: filing.year, quarter: filing.quarter, recordCount: filing.records.length })

  return db.$transaction(async (tx) => {
    const updated = await tx.partXXFiling.update({
      where: { id: filingId },
      data: { status: 'FILED', submittedXml: xml, t619TransmissionRef: t619.transmissionRef, submittedAt: new Date(), submittedById: actorId },
    })
    await tx.partXXRecord.updateMany({ where: { filingId }, data: { status: 'FILED' } })
    return updated
  })
}

// The ONLY way a filing ever becomes ACCEPTED or REJECTED -- a human pastes in CRA's real response.
// There is no automatic acceptance anywhere in this codebase.
export async function recordCraResponse(db, filingId, { status, craResponse, actorId }) {
  if (!['ACCEPTED', 'REJECTED'].includes(status)) fail('PART_XX_RESPONSE_STATUS_INVALID', 'status must be ACCEPTED or REJECTED.')
  const filing = await db.partXXFiling.findUnique({ where: { id: filingId } })
  if (!filing) fail('PART_XX_FILING_NOT_FOUND', 'Filing not found.', 404)
  if (filing.status !== 'FILED') fail('PART_XX_FILING_NOT_FILED', 'A CRA response can only be recorded for a FILED filing.', 409)

  return db.$transaction(async (tx) => {
    const updated = await tx.partXXFiling.update({
      where: { id: filingId },
      data: { status, craResponse, acceptedAt: status === 'ACCEPTED' ? new Date() : null },
    })
    await tx.partXXRecord.updateMany({ where: { filingId }, data: { status } })
    await tx.adminAuditLog.create({
      data: { actorUserId: actorId, action: `PART_XX_${status}`, entityType: 'part_xx_filings', entityId: filingId, before: { status: 'FILED' }, after: { status, craResponse } },
    })
    return updated
  })
}

// Reopens a FILED/ACCEPTED/REJECTED filing's records for correction under a NEW filing row. The
// ORIGINAL filing (including its submittedXml) is never modified -- it stays the permanent record of
// what was actually sent. The records move to CORRECTED and re-attach to the new filing so they can
// go through DRAFT -> VALIDATED -> FILED again with revised figures.
export async function createCorrectionFiling(db, { originalFilingId, actorId, reason }) {
  const original = await db.partXXFiling.findUnique({ where: { id: originalFilingId }, include: { records: true } })
  if (!original) fail('PART_XX_FILING_NOT_FOUND', 'Filing not found.', 404)
  if (!['FILED', 'ACCEPTED', 'REJECTED'].includes(original.status)) {
    fail('PART_XX_FILING_NOT_CORRECTABLE', 'Only a FILED, ACCEPTED, or REJECTED filing can be corrected.', 409)
  }

  return db.$transaction(async (tx) => {
    const correction = await tx.partXXFiling.create({ data: { year: original.year, quarter: original.quarter, status: 'DRAFT', correctionOfId: original.id } })
    await tx.partXXRecord.updateMany({
      where: { id: { in: original.records.map((r) => r.id) } },
      data: { status: 'CORRECTED', filingId: correction.id },
    })
    await tx.adminAuditLog.create({
      data: { actorUserId: actorId, action: 'PART_XX_CORRECTION_OPENED', entityType: 'part_xx_filings', entityId: correction.id, before: { originalFilingId }, after: { reason: reason || null } },
    })
    return correction
  })
}

const DISCLAIMER = {
  en: 'SYBNB-generated information statement. This is not a T4, RL-1, T4A or other employment slip and does not replace professional tax advice.',
  fr: "Relevé d'information généré par SYBNB. Il ne s'agit pas d'un T4, d'un RL-1, d'un T4A ni d'un autre feuillet d'emploi et il ne remplace pas les conseils d'un professionnel de la fiscalité.",
}

function money(minor, currency) {
  return `${Math.round(minor || 0).toLocaleString('en-US')} ${currency}`
}

// "Part XX Annual Platform Statement" -- the seller's own copy of what was aggregated about them for
// the year, due by January 31. Combines RIDE + ACCOMMODATION records for one seller across all four
// quarters; a seller who is only a driver or only a host simply has one activity type populated.
export function renderPartXXAnnualStatement(records, { year, lang = 'en', sellerName = '' } = {}) {
  const t = lang === 'fr'
    ? {
        title: 'Relevé annuel de plateforme (Partie XX)',
        seller: 'Vendeur', year: 'Année', activity: 'Type d\'activité', gross: 'Contrepartie brute',
        count: 'Nombre d\'activités', fees: 'Commissions et frais de la plateforme', withheld: 'Taxes retenues/perçues',
        refunds: 'Remboursements et ajustements', address: 'Adresse de l\'hébergement',
      }
    : {
        title: 'Part XX Annual Platform Statement',
        seller: 'Seller', year: 'Year', activity: 'Activity type', gross: 'Gross consideration',
        count: 'Number of activities', fees: 'Platform commissions and fees', withheld: 'Taxes withheld/collected',
        refunds: 'Refunds and adjustments', address: 'Accommodation address',
      }

  const lines = [t.title, sellerName ? `${t.seller}: ${sellerName}` : '', `${t.year}: ${year}`, '']
  for (const r of records) {
    lines.push(`${t.activity}: ${r.activityType}`)
    lines.push(`${t.gross}: ${money(r.grossConsiderationMinor, r.currency)}`)
    lines.push(`${t.count}: ${r.activityCount}`)
    lines.push(`${t.fees}: ${money(r.platformFeesMinor, r.currency)}`)
    lines.push(`${t.withheld}: ${money(r.taxesWithheldMinor, r.currency)}`)
    lines.push(`${t.refunds}: ${money(r.refundsMinor, r.currency)}`)
    if (r.propertyAddress) lines.push(`${t.address}: ${r.propertyAddress}`)
    lines.push('')
  }
  lines.push(DISCLAIMER[lang] || DISCLAIMER.en)
  return lines.join('\n')
}

export { DISCLAIMER as PART_XX_DISCLAIMER }
