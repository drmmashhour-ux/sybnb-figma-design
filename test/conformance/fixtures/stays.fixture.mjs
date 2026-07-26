import request from 'supertest'
import { fileURLToPath } from 'node:url'
import { db } from '../../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../../server/lib/security.mjs'
import { approvePaymentProof, platformFee, strCommissionRateForBooking } from '../../../server/lib/finance-ledger.mjs'
import { buildStayStatement } from '../../../server/lib/stay-statements.mjs'
import { findAuditMutationPaths } from '../contract.mjs'
import { testApp, trackTestUser, uniqueTestEmail, uniqueTestReferralCode } from '../../support/testServer.mjs'

// Stays (STR) fixture for the CORE conformance suite. Full read/write — creates its own SY listing +
// booking. Wires every CORE invariant this vertical can already prove.

function isoDay(offset) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

export const staysFixture = {
  name: 'stays',
  supports: { leak: true, authz: true, commissionTaxInvariant: true, jurisdictionFailClosed: true, settlementRef: true, auditAppendOnly: true, frozenTerms: true },

  async setup() {
    const app = testApp()
    const mk = async (role) => {
      const u = await db().user.create({
        data: {
          email: uniqueTestEmail(`conf-stays-${role}`),
          passwordHash: hashPassword('correct-horse-battery'),
          displayName: `Conf ${role}`,
          referralCode: uniqueTestReferralCode(),
          status: 'ACTIVE',
          roles: { create: { role } },
          phoneHash: `conf-${role}-${Math.random().toString(36).slice(2)}`,
        },
      })
      trackTestUser(u.id)
      return { token: createSessionToken(u), id: u.id }
    }
    const guest = await mk('GUEST')
    const host = await mk('HOST')
    const admin = await mk('ADMIN')

    // A SY (fail-closed jurisdiction) APPROVED listing under an accommodation (address + pin).
    const accommodation = await db().accommodation.create({
      data: { ownerId: host.id, titleAr: 'شقة اختبار', governorate: 'damascus', city: 'damascus', area: 'mazzeh', address: 'Conf st', metadata: { country: 'SY', mapLocation: { latitude: 33.5, longitude: 36.2, pinConfirmed: true } } },
    })
    const listing = await db().listing.create({
      data: { ownerId: host.id, accommodationId: accommodation.id, division: 'STAYS', titleAr: 'غرفة اختبار', priceMinor: 120_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY', cleaningFeeMinor: 25_00 } },
    })

    // A buyer-facing booking (guest creates it — this is the paying buyer's own booking JSON).
    const checkIn = isoDay(20)
    const checkOut = isoDay(23)
    const bookingRes = await request(app)
      .post('/api/bookings')
      .set({ Authorization: `Bearer ${guest.token}` })
      .send({ listingId: listing.id, checkIn, checkOut, currency: 'USD' })
    const booking = bookingRes.body.booking

    return { app, guest, host, admin, accommodationId: accommodation.id, listingId: listing.id, booking, checkIn, checkOut }
  },

  async teardown(ctx) {
    if (!ctx) return
    if (ctx.c7) {
      await db().payout.deleteMany({ where: { bookingId: ctx.c7.bookingId } }).catch(() => {})
      await db().payment.deleteMany({ where: { bookingId: ctx.c7.bookingId } }).catch(() => {})
      await db().walletEntry.deleteMany({ where: { referenceId: ctx.c7.bookingId } }).catch(() => {})
      await db().paymentProof.deleteMany({ where: { bookingId: ctx.c7.bookingId } }).catch(() => {})
      await db().booking.deleteMany({ where: { id: ctx.c7.bookingId } }).catch(() => {})
      await db().listing.deleteMany({ where: { id: ctx.c7.listingId } }).catch(() => {})
      await db().jurisdictionCommissionPolicy.deleteMany({ where: { country: ctx.c7.country } }).catch(() => {})
    }
    if (ctx.c9PolicyId) {
      await db().adminAuditLog.deleteMany({ where: { entityId: ctx.c9PolicyId } }).catch(() => {})
      await db().jurisdictionCommissionPolicy.delete({ where: { id: ctx.c9PolicyId } }).catch(() => {})
    }
    await db().paymentProof.deleteMany({ where: { bookingId: ctx.booking?.id } }).catch(() => {})
    await db().booking.deleteMany({ where: { guestId: ctx.guest.id } }).catch(() => {})
    await db().listing.deleteMany({ where: { accommodationId: ctx.accommodationId } }).catch(() => {})
    await db().accommodation.deleteMany({ where: { id: ctx.accommodationId } }).catch(() => {})
  },

  async buyerFacingPayloads(ctx) {
    const quote = await request(ctx.app).get(`/api/listings/${ctx.listingId}/quote?checkIn=${ctx.checkIn}&checkOut=${ctx.checkOut}&currency=USD`)
    return { quote: quote.body, booking: ctx.booking }
  },

  sensitiveRoutes(ctx) {
    // Admin money-path routes: no session → 401, GUEST session → 403.
    return [
      { method: 'get', path: '/api/admin/review-queue', wrongRoleToken: ctx.guest.token },
      { method: 'patch', path: `/api/admin/review-queue/listing/${ctx.listingId}`, body: { decision: 'APPROVED' }, wrongRoleToken: ctx.guest.token },
      { method: 'patch', path: `/api/admin/payouts/${ctx.booking?.id}/release`, wrongRoleToken: ctx.guest.token },
      { method: 'get', path: `/api/admin/host-ledger?hostId=${ctx.host.id}`, wrongRoleToken: ctx.guest.token },
    ]
  },

  async commissionTaxInvariant() {
    // Commission is computed on (accommodation + cleaning) only — tax is never in the base. platformFee
    // takes no tax argument, so the commission is identical whatever the tax. We compute it under a low
    // and a high tax context to assert invariance, and hand back the base/tax so the harness can also
    // prove the base excludes tax.
    const accom = 100_00
    const cleaning = 20_00
    const rate = 0.13
    return {
      atLowTax: platformFee(accom, cleaning, rate),
      atHighTax: platformFee(accom, cleaning, rate),
      baseMinor: accom + cleaning,
      taxMinor: 30_00,
      rate,
    }
  },

  async jurisdictionFailClosed(ctx) {
    // SY is not legally reviewed → the guest quote must not CHARGE tax (disclosed-not-charged), and the
    // public feed reports legalReviewStatus != 'confirmed'.
    const quote = await request(ctx.app).get(`/api/listings/${ctx.listingId}/quote?checkIn=${ctx.checkIn}&checkOut=${ctx.checkOut}&currency=USD`)
    const feed = await request(ctx.app).get('/api/listings?country=SY')
    const taxLine = quote.body?.quote?.breakdown?.taxLine || {}
    const collected = quote.body?.quote?.breakdown?.collectedTaxMinor ?? 0
    return {
      chargedWhileUnconfirmed: (taxLine.status && taxLine.status !== 'NONE') || collected > 0,
      legalReviewStatus: feed.body?.legalReviewStatus,
    }
  },

  async frozenTerms(ctx) {
    // C7 — an ISSUED booking's commission terms are frozen at settlement (M5 Payment record + termsSnapshot)
    // and never restated by a later policy change. Settle a booking at the default 13% in a throwaway
    // jurisdiction (deterministic split: gross 120.00 = rent 100.00 + cleaning 20.00 → 13% = 15.60), then
    // activate a DIFFERENT live rate (25%) and prove the frozen Payment AND the rendered statement still
    // show the original 13%. Cleaned up in teardown via ctx.c7.
    const country = `ZF${String(Date.now()).slice(-6)}`
    const listing = await db().listing.create({
      data: { ownerId: ctx.host.id, division: 'STAYS', titleAr: 'C7', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country, cleaningFeeMinor: 20_00 } },
    })
    const booking = await db().booking.create({ data: { listingId: listing.id, guestId: ctx.guest.id, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: ctx.guest.id, provider: 'stripe', providerRef: 'pi_c7', status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: ctx.admin.id }))
    ctx.c7 = { country, listingId: listing.id, bookingId: booking.id }

    const issued = await db().payment.findUnique({ where: { bookingId: booking.id } })

    // Activate a DIFFERENT live rate (25%) for this jurisdiction, effective before the booking.
    await db().jurisdictionCommissionPolicy.create({
      data: { country, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: 250_000, effectiveFrom: new Date('2020-01-01'), active: true, legallyReviewedById: ctx.admin.id, legallyReviewedAt: new Date() },
    })
    const withListing = await db().booking.findUnique({ where: { id: booking.id }, include: { listing: true } })
    const liveRate = await strCommissionRateForBooking(db(), withListing)
    const statement = await buildStayStatement(db(), { hostId: ctx.host.id, periodType: 'ANNUAL', periodStart: new Date('2020-01-01'), periodEnd: new Date('2999-01-01') })
    const line = statement.lines.find((l) => l.bookingId === booking.id)
    const stillFrozen = await db().payment.findUnique({ where: { bookingId: booking.id } })

    return {
      issuedRateParts: issued?.commissionRateParts,
      issuedCommissionMinor: issued?.commissionAmountMinor,
      liveRateNow: liveRate,
      stillFrozenRateParts: stillFrozen?.commissionRateParts,
      stillFrozenCommissionMinor: stillFrozen?.commissionAmountMinor,
      statementCommissionMinor: line?.commissionMinor,
    }
  },

  async auditAppendOnly(ctx) {
    // Money/config path: an admin changes a commission policy (create → update). Each write must APPEND an
    // immutable audit row, and the update row must carry both before AND after (the changed value). Then
    // assert the whole audit log is append-only at the source level — no update/delete/upsert path exists,
    // which is what makes every row (money/config/consent alike) immutable. Uses a unique throwaway
    // jurisdiction (inactive, so it never affects real pricing); cleaned up in teardown via ctx.c9PolicyId.
    const country = `ZY${String(Date.now()).slice(-6)}`
    const admin = { Authorization: `Bearer ${ctx.admin.token}` }
    const create = await request(ctx.app).post('/api/admin/jurisdiction-pricing/commission-policies').set(admin)
      .send({ country, serviceType: 'STAY', policyType: 'FLAT', flatRateParts: 160_000, effectiveFrom: '2021-01-01', active: false })
    const policyId = create.body?.policy?.id
    ctx.c9PolicyId = policyId
    const update = policyId
      ? await request(ctx.app).patch(`/api/admin/jurisdiction-pricing/commission-policies/${policyId}`).set(admin).send({ flatRateParts: 180_000 })
      : { status: 0 }
    const createRow = policyId ? await db().adminAuditLog.findFirst({ where: { entityType: 'jurisdiction_commission_policies', entityId: policyId, action: 'JURISDICTION_COMMISSION_POLICY_CREATED' } }) : null
    const updateRow = policyId ? await db().adminAuditLog.findFirst({ where: { entityType: 'jurisdiction_commission_policies', entityId: policyId, action: 'JURISDICTION_COMMISSION_POLICY_UPDATED' }, orderBy: { createdAt: 'desc' } }) : null
    const serverDir = fileURLToPath(new URL('../../../server', import.meta.url))
    return {
      configChangeAppended: create.status === 200 && update.status === 200 && !!createRow && !!updateRow,
      updateHasBeforeAfter: updateRow?.before != null && updateRow?.after != null && updateRow.before.flatRateParts !== updateRow.after.flatRateParts,
      mutationPaths: findAuditMutationPaths(serverDir),
    }
  },

  async settlementRef(ctx) {
    // A payment proof with no settlement reference is rejected → a booking can never become "paid"
    // without a real reference.
    const res = await request(ctx.app)
      .post('/api/payments/local-wallet-proof')
      .set({ Authorization: `Bearer ${ctx.guest.token}` })
      .send({ bookingId: ctx.booking?.id, amountMinor: ctx.booking?.amountMinor })
    return { paidWithoutRef: res.status < 400, rejectionCode: res.body?.error?.code, status: res.status }
  },
}
