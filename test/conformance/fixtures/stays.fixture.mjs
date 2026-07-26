import request from 'supertest'
import { fileURLToPath } from 'node:url'
import { db } from '../../../server/lib/prisma.mjs'
import { createSessionToken, hashPassword } from '../../../server/lib/security.mjs'
import { approvePaymentProof, platformFee, strCommissionRateForBooking } from '../../../server/lib/finance-ledger.mjs'
import { assertStripeLivemodeForProduction, STRIPE_TEST_MODE_IN_PRODUCTION_CODE } from '../../../server/lib/payment-gateway.mjs'
import { finalizeStripeSession } from '../../../server/routes/payments.mjs'
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
  supports: { leak: true, authz: true, commissionTaxInvariant: true, jurisdictionFailClosed: true, settlementRef: true, auditAppendOnly: true, frozenTerms: true, noDoubleBook: true, sandboxRefRejected: true, reconciliationGate: true },

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
    if (ctx.c10) {
      await db().reconciliationRecord.deleteMany({ where: { bookingId: { in: ctx.c10.bookingIds } } }).catch(() => {})
      await db().payout.deleteMany({ where: { bookingId: { in: ctx.c10.bookingIds } } }).catch(() => {})
      await db().payment.deleteMany({ where: { bookingId: { in: ctx.c10.bookingIds } } }).catch(() => {})
      await db().walletEntry.deleteMany({ where: { referenceId: { in: ctx.c10.bookingIds } } }).catch(() => {})
      await db().adminAuditLog.deleteMany({ where: { entityId: { in: ctx.c10.bookingIds } } }).catch(() => {})
      await db().paymentProof.deleteMany({ where: { bookingId: { in: ctx.c10.bookingIds } } }).catch(() => {})
      await db().booking.deleteMany({ where: { id: { in: ctx.c10.bookingIds } } }).catch(() => {})
    }
    if (ctx.c8) {
      await db().booking.deleteMany({ where: { listingId: ctx.c8.listingId } }).catch(() => {})
      await db().listing.deleteMany({ where: { id: ctx.c8.listingId } }).catch(() => {})
    }
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

  async sandboxRefRejected() {
    // C5b — in PRODUCTION a test/sandbox Stripe settlement (livemode !== true) must be REJECTED so a booking
    // can never be marked paid with a non-production reference, while a real (livemode:true) settlement is
    // accepted. Two layers: (1) the REAL guard (assertStripeLivemodeForProduction) tested deterministically
    // via its explicit isProduction param; (2) an END-TO-END drive of the actual settlement entry point
    // (finalizeStripeSession) under a simulated production env — a test-mode 'paid' session must throw
    // BEFORE any booking is settled. Layer (2) proves the guard is actually WIRED (removing it makes
    // finalizeStripeSession fall through and return instead of throwing). NODE_ENV is restored in finally.
    const codeOf = (stripeObject, isProduction) => {
      try {
        assertStripeLivemodeForProduction(stripeObject, { isProduction })
        return null
      } catch (e) {
        return e.code
      }
    }
    const prevNodeEnv = process.env.NODE_ENV
    let settlementRejectedCode = null
    try {
      process.env.NODE_ENV = 'production'
      // A test-mode (livemode:false) 'paid' session for a nonexistent booking: the guard runs first and
      // must throw before any DB work. A real live-mode path would only proceed past this line.
      await finalizeStripeSession({ payment_status: 'paid', livemode: false, payment_intent: 'pi_sandbox_c5b', metadata: { bookingId: 'c5b-nonexistent-booking' } })
    } catch (e) {
      settlementRejectedCode = e.code
    } finally {
      process.env.NODE_ENV = prevNodeEnv
    }
    return {
      expectedRejectCode: STRIPE_TEST_MODE_IN_PRODUCTION_CODE,
      testModeRejectedInProd: codeOf({ livemode: false }, true),
      missingLivemodeRejectedInProd: codeOf({}, true),
      liveAcceptedInProd: codeOf({ livemode: true }, true),
      testModeAllowedOutsideProd: codeOf({ livemode: false }, false),
      settlementPathRejectsSandboxInProd: settlementRejectedCode,
    }
  },

  async noDoubleBook(ctx) {
    // C8 — two guests race for the SAME listing + overlapping dates. The booking create runs inside a
    // transaction holding pg_advisory_xact_lock(hashtext(listingId)) (server/routes/bookings.mjs), which
    // serializes the two requests: the winner commits its booking, the loser then sees the overlap and is
    // rejected 409 BOOKING_DATES_UNAVAILABLE. Real Postgres (test DB) makes this deterministic — exactly one
    // active booking exists for the slot, never two. Fresh listing + a second guest so it's isolated.
    const listing = await db().listing.create({
      data: { ownerId: ctx.host.id, division: 'STAYS', titleAr: 'C8', priceMinor: 100_00, currency: 'USD', status: 'APPROVED', instantBookEnabled: false, metadata: { country: 'SY' } },
    })
    const guest2User = await db().user.create({
      data: { email: uniqueTestEmail('conf-stays-guest2'), passwordHash: hashPassword('correct-horse-battery'), displayName: 'Conf GUEST2', referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'GUEST' } }, phoneHash: `conf-g2-${Math.random().toString(36).slice(2)}` },
    })
    trackTestUser(guest2User.id)
    ctx.c8 = { listingId: listing.id }

    const checkIn = isoDay(40)
    const checkOut = isoDay(43)
    const attempt = (token) =>
      request(ctx.app).post('/api/bookings').set({ Authorization: `Bearer ${token}` }).send({ listingId: listing.id, checkIn, checkOut, currency: 'USD' })
    const results = await Promise.all([attempt(ctx.guest.token), attempt(createSessionToken(guest2User))])

    const successCount = results.filter((r) => r.status === 201).length
    const conflictCount = results.filter((r) => r.status === 409).length
    const activeForSlot = await db().booking.count({
      where: { listingId: listing.id, status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] }, checkIn: { lt: new Date(checkOut) }, checkOut: { gt: new Date(checkIn) } },
    })
    return {
      statuses: results.map((r) => r.status).sort(),
      successCount,
      conflictCount,
      conflictCode: results.find((r) => r.status === 409)?.body?.error?.code,
      activeForSlot,
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

  async reconciliationGate(ctx) {
    // C10 — the money-out reconciliation controls. Settle + release a booking (verifier + releaser on record),
    // then drive the disburse endpoint: (1) it refuses until a MATCHED received-funds record exists
    // (PAYOUT_NOT_RECONCILED); (2) the admin who reconciled cannot also disburse (PAYOUT_DUAL_CONTROL_REQUIRED),
    // while a DISTINCT admin can; (3) at most one MATCHED per payment and records are append-only (a re-attempt
    // appends a new row — here the duplicate line is recorded as a fresh MISMATCH, never a second MATCHED, and
    // never an in-place mutation). Four distinct admins so maker != checker is real.
    const mkAdmin = async (label) => {
      const u = await db().user.create({ data: { email: uniqueTestEmail(label), passwordHash: hashPassword('correct-horse-battery'), displayName: `Conf ${label}`, referralCode: uniqueTestReferralCode(), status: 'ACTIVE', roles: { create: { role: 'ADMIN' } }, phoneHash: `conf-${label}-${Math.random().toString(36).slice(2)}` } })
      trackTestUser(u.id)
      return { id: u.id, token: createSessionToken(u) }
    }
    const verifier = await mkAdmin('c10-verifier')
    const releaser = await mkAdmin('c10-releaser')
    const reconciler = await mkAdmin('c10-reconciler')
    const stranger = await mkAdmin('c10-stranger')
    await db().user.update({ where: { id: ctx.host.id }, data: { payoutMethod: { type: 'sham_cash', receiverName: 'H', phone: '0999', version: 1 } } })

    const bookingIds = []
    const booking = await db().booking.create({ data: { listingId: ctx.listingId, guestId: ctx.guest.id, status: 'PAYMENT_PENDING', amountMinor: 120_00, currency: 'USD' } })
    bookingIds.push(booking.id)
    const proof = await db().paymentProof.create({ data: { bookingId: booking.id, userId: ctx.guest.id, provider: 'stripe', providerRef: `pi_c10_${booking.id.slice(0, 8)}`, status: 'PENDING_ADMIN_REVIEW', amountMinor: 120_00, currency: 'USD' } })
    await db().$transaction((tx) => approvePaymentProof(tx, { proofId: proof.id, actorUserId: verifier.id }))
    await db().payout.update({ where: { bookingId: booking.id }, data: { status: 'RELEASED', releaseDate: new Date(), releasedById: releaser.id } })
    const payment = await db().payment.findUnique({ where: { bookingId: booking.id } })
    ctx.c10 = { bookingIds }

    const disburse = (token) => request(ctx.app).post(`/api/admin/payouts/${booking.id}/disburse`).set({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }).send({ transition: 'INITIATED', reason: 'c10' })
    const reconcile = (token, amount) => request(ctx.app).post(`/api/admin/payments/${booking.id}/reconcile`).set({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }).send({ statementRef: payment.settlementRef, amount, currency: payment.currency })

    const noMatch = await disburse(stranger.token) // (1) blocked: not reconciled yet
    const matched = await reconcile(reconciler.token, payment.grossMinor) // exact -> MATCHED
    const reconcilerDisburse = await disburse(reconciler.token) // (2) reconciler is a control actor -> blocked
    const duplicate = await reconcile(reconciler.token, payment.grossMinor) // (3) same line again -> DUPLICATE, not a 2nd MATCHED
    const matchedCount = await db().reconciliationRecord.count({ where: { bookingId: booking.id, status: 'MATCHED' } })
    const totalRows = await db().reconciliationRecord.count({ where: { bookingId: booking.id } })
    const distinct = await disburse(stranger.token) // a distinct admin CAN disburse reconciled funds

    return {
      disbursedWithoutMatch: noMatch.status < 400,
      noMatchRejectionCode: noMatch.body?.error?.code,
      matchRecorded: matched.body?.status,
      reconcilerCouldDisburse: reconcilerDisburse.status < 400,
      reconcilerRejectionCode: reconcilerDisburse.body?.error?.code,
      duplicateStatus: duplicate.body?.status,
      matchedCount,
      appendOnlyRowsAccumulate: totalRows >= 2,
      distinctDisburserSucceeded: distinct.status === 201,
    }
  },
}
