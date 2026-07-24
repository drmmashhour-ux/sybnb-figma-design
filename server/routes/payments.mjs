import Stripe from 'stripe'
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, recordWalletEntry, CANCELLATION_PROTECTION_RATE } from '../lib/finance-ledger.mjs'
import { assertStripeLivemodeForProduction } from '../lib/payment-gateway.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { isAllowedOrigin } from '../lib/allowed-origins.mjs'

// A client-supplied `origin` is trusted verbatim into Stripe's success_url/cancel_url below --
// unvalidated, that's an open redirect: right after a REAL captured payment, the guest lands on
// whatever URL the request named, with the Stripe session id in the query string. Validate it
// against the same allow-list CORS uses before it's ever used in a redirect URL.
function assertAllowedOrigin(origin) {
  if (!isAllowedOrigin(origin)) {
    const error = new Error('origin is not an allowed SYBNB app origin.')
    error.statusCode = 400
    error.code = 'STRIPE_SESSION_ORIGIN_NOT_ALLOWED'
    error.expose = true
    throw error
  }
}

// Guest contact info (PATCH /api/bookings/:id/contact) replaced the old ID-upload-before-payment
// gate. Originally left as a UI-only nudge rather than a server-enforced requirement -- flagged as
// a real gap and confirmed it should be a hard requirement instead: a guest cannot start payment
// (either path) until their booking carries a guestContactPhone, closing the same
// "client claims a requirement the server never actually checks" gap the old ID-verification
// gate had before it was fixed.
function requireGuestContactInfo(booking) {
  if (!booking.metadata?.guestContactPhone) {
    const error = new Error('Add your name and phone number before paying for this booking.')
    error.statusCode = 403
    error.code = 'GUEST_CONTACT_INFO_REQUIRED'
    error.expose = true
    throw error
  }
}

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

function requireStripe() {
  if (!stripe) {
    const error = new Error('Stripe is not configured on this server yet.')
    error.statusCode = 503
    error.code = 'STRIPE_NOT_CONFIGURED'
    error.expose = true
    throw error
  }
  return stripe
}

function metadataNumber(metadata, key) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

// Money-model correction (2026-07-22): booking.amountMinor is now the canonical, all-inclusive
// guest total set once at creation (server/lib/pricing.mjs's computeGuestBookingTotalMinor --
// nightly subtotal + cleaning fee + extra fees). This function used to ALSO add
// metadata.cleaningFeeMinor/taxesMinor here, a second time, on top of booking.amountMinor -- so a
// guest who paid exactly the total they were quoted and confirmed at checkout got
// PAYMENT_AMOUNT_TOO_LOW (an earlier, incomplete fix already removed a similar rate-based
// auto-surcharge; this removes the remaining metadata-driven one, the actual root cause). The only
// thing that may still legitimately add to booking.amountMinor at charge time is the optional
// cancellation-protection premium, which is deliberately never folded into amountMinor itself (see
// bookings.mjs's creation comment) since it's an opt-in add-on, not part of the base stay price.
// Québec lodging tax stays disclosure-only (explicit product decision) and was never added here.
function expectedTotalMinor(booking) {
  const stayAmountMinor = Math.max(0, Math.round(booking.amountMinor || 0))
  const bookingMetadata = booking.metadata || {}

  const cancellationProtectionPurchased = bookingMetadata.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased
    ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') || Math.round(stayAmountMinor * CANCELLATION_PROTECTION_RATE)
    : 0

  return stayAmountMinor + cancellationProtectionFeeMinor
}

// bookings.amountMinor is a WHOLE-unit amount in the booking's own currency (e.g. 50 means $50 for
// a USD booking, not 50 cents -- see expectedTotalMinor/guestFeeSummary.ts) -- it is only "minor"
// relative to SYP, which has no meaningful subunit. Stripe always needs its settlement currency's
// smallest unit (cents for USD). SYP is not a Stripe-supported settlement currency, so a
// SYP-denominated booking is FX-converted into STRIPE_CURRENCY (USD by default) using a
// configurable placeholder rate -- swap SYP_PER_USD for a live FX feed before this handles real
// money. A booking already denominated in the settlement currency needs ONLY the cents conversion,
// never FX -- treating every booking as if it needed SYP->USD conversion (dividing by SYP_PER_USD)
// previously undercharged every USD booking to about 1/150th of what was owed.
function stripeChargeAmount(totalMinor, bookingCurrency) {
  const settlementCurrency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase()
  const normalizedBookingCurrency = String(bookingCurrency || '').toLowerCase()

  if (normalizedBookingCurrency === settlementCurrency) {
    return { currency: settlementCurrency, unitAmount: Math.max(50, Math.round(totalMinor * 100)) }
  }

  if (normalizedBookingCurrency === 'syp' && settlementCurrency !== 'syp') {
    const sypPerUsd = Number(process.env.SYP_PER_USD || 15000)
    return { currency: settlementCurrency, unitAmount: Math.max(50, Math.round((totalMinor / sypPerUsd) * 100)) }
  }

  const error = new Error(`No Stripe FX path from ${normalizedBookingCurrency || 'unknown'} to ${settlementCurrency}.`)
  error.statusCode = 422
  error.code = 'STRIPE_FX_PATH_MISSING'
  error.expose = true
  throw error
}

async function firstAdminId(tx) {
  const admin = await tx.userRole.findFirst({ where: { role: 'ADMIN' }, select: { userId: true } })
  return admin?.userId
}

// SR cashless card top-up (016): the 2.35% card fee is ADDED ON TOP, computed server-side (never client).
export const CARD_TOPUP_FEE_RATE = 0.0235
const WALLET_TOPUP_MAX_MINOR = 100_000_000

// Amount charged to the card in Stripe's smallest unit (cents). base $100 → round(100*100*1.0235) = 10235.
export function cardTopupChargeCents(baseMinor) {
  return Math.round(baseMinor * 100 * (1 + CARD_TOPUP_FEE_RATE))
}
// Platform fee recorded in the whole-unit ledger: round(base*0.0235). base 100 → 2. The sub-unit remainder
// (e.g. $0.35) collects into the platform's Stripe balance; below ledger precision, never owed to the rider.
export function cardTopupFeeMinor(baseMinor) {
  return Math.round(baseMinor * CARD_TOPUP_FEE_RATE)
}

// Credits a paid wallet_topup Checkout session: BASE to the rider, fee to platform. Idempotent on the
// session id. Called ONLY from the signature-verified webhook — never the browser redirect.
export async function creditWalletTopupSession(session) {
  if (session.metadata?.kind !== 'wallet_topup' || session.payment_status !== 'paid') return null
  const userId = session.metadata.userId
  const baseMinor = Number(session.metadata.baseMinor || 0)
  const currency = session.metadata.currency || 'USD'
  if (!userId || !Number.isInteger(baseMinor) || baseMinor <= 0) return null
  const feeMinor = cardTopupFeeMinor(baseMinor)
  return db().$transaction(async (tx) => {
    const credit = await recordWalletEntry(tx, {
      userId, type: 'CREDIT', amountMinor: baseMinor, currency,
      referenceType: 'wallet_topup', referenceId: session.id, keyParts: ['wallet-topup-stripe', session.id],
      note: 'Card wallet top-up: base credit added after Stripe confirmed the charge was captured.',
    })
    if (feeMinor > 0) {
      const platformUserId = await firstAdminId(tx)
      if (platformUserId) {
        await recordWalletEntry(tx, {
          userId: platformUserId, type: 'CREDIT', amountMinor: feeMinor, currency,
          referenceType: 'card_processing_fee', referenceId: session.id, keyParts: ['wallet-topup-stripe-fee', session.id],
          note: 'SYBNB/platform collected the 2.35% card-processing fee on a wallet top-up.',
        })
      }
    }
    return credit
  })
}

// Sourced from Stripe's own balance_transaction for this specific charge -- never an assumed
// rate, since the real fee varies by card type/country and, when the account settles in a
// different currency than the charge (this account charges USD but settles in CAD), by a
// currency-conversion fee on top of the base processing fee. Converts the fee back into the
// charge's own currency using the very exchange_rate Stripe applied to this charge.
//
// The balance_transaction isn't always attached to the charge the instant it succeeds -- when a
// currency conversion is involved (as here), Stripe needs a moment to resolve the FX rate before
// attaching fee/exchange_rate. Retrying immediately with no wait reliably read this as "not there
// yet" and returned 0, silently skipping the host-side deduction. Poll with short backoff instead
// of a single best-effort read.
async function fetchStripeCardFeeMinor(session) {
  if (!session.payment_intent) return 0
  const delaysMs = [300, 700, 1500, 3000]
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      const intent = await stripe.paymentIntents.retrieve(session.payment_intent, {
        expand: ['latest_charge.balance_transaction'],
      })
      const balanceTransaction = intent.latest_charge?.balance_transaction
      if (balanceTransaction && typeof balanceTransaction.fee === 'number') {
        const exchangeRate = balanceTransaction.exchange_rate || 1
        return Math.max(0, Math.round(balanceTransaction.fee / exchangeRate / 100))
      }
    } catch {
      // Fall through to retry/give-up below -- never let a fee-lookup failure block a real,
      // already-captured payment from being confirmed.
    }
    if (attempt < delaysMs.length) {
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
  return 0
}

export async function finalizeStripeSession(session) {
  // A wallet top-up is credited exclusively by creditWalletTopupSession() from the webhook — never here.
  if (session.metadata?.kind === 'wallet_topup') return null
  const bookingId = session.metadata?.bookingId
  if (!bookingId || session.payment_status !== 'paid') return null

  // M3-A: reject a TEST-mode settlement in production via Stripe's livemode flag (never string-matching).
  assertStripeLivemodeForProduction(session)
  // M3-A: the REAL settlement reference is the captured payment_intent id (pi_…), never the cs_ session id.
  // No captured payment_intent means no real settlement — do not confirm the booking.
  const settlementRef = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null
  if (!settlementRef) return null

  const paymentProcessingFeeMinor = await fetchStripeCardFeeMinor(session)

  return db().$transaction(async (tx) => {
    const existingProof = await tx.paymentProof.findFirst({
      where: { provider: 'stripe', providerRef: settlementRef },
    })
    if (existingProof) return existingProof

    const booking = await tx.booking.findUnique({ where: { id: bookingId } })
    if (!booking || booking.status !== 'PAYMENT_PENDING') return null

    const created = await tx.paymentProof.create({
      data: {
        bookingId: booking.id,
        userId: booking.guestId,
        provider: 'stripe',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor: Number(session.metadata?.bookingTotalMinor || booking.amountMinor),
        currency: booking.currency,
        // M3-A: the settlement reference is the captured payment_intent id (a real capture), not the
        // cs_ Checkout Session id. The session id is retained in proofAssetUrl for traceability.
        providerRef: settlementRef,
        proofAssetUrl: `stripe://checkout_sessions/${session.id}`,
      },
    })

    const actorUserId = await firstAdminId(tx)
    const approved = await approvePaymentProof(tx, {
      proofId: created.id,
      actorUserId,
      note: 'Auto-approved: Stripe confirmed the card charge was captured.',
      paymentProcessingFeeMinor,
    })

    await tx.adminAuditLog.create({
      data: {
        actorUserId: actorUserId || null,
        action: 'STRIPE_PAYMENT_AUTO_APPROVED',
        entityType: 'payment_proofs',
        entityId: approved.id,
        before: {
          status: created.status,
          provider: created.provider,
          providerRef: created.providerRef,
          bookingId: created.bookingId,
        },
        after: {
          status: approved.status,
          provider: approved.provider,
          providerRef: approved.providerRef,
          bookingId: approved.bookingId,
          stripeSessionId: session.id,
        },
      },
    })

    return approved
  })
}

export async function handlePayments(req, res, url, context) {
  if (url.pathname === '/api/payments/stripe/create-checkout-session') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])

    const body = await readJson(req)
    const bookingId = String(body.bookingId || '')
    const origin = String(body.origin || '').replace(/\/$/, '')
    if (!bookingId || !origin) {
      const error = new Error('bookingId and origin are required.')
      error.statusCode = 400
      error.code = 'STRIPE_SESSION_INPUT_INVALID'
      error.expose = true
      throw error
    }
    assertAllowedOrigin(origin)

    const booking = await db().booking.findFirst({
      where: { id: bookingId, guestId: context.user.id },
      include: { listing: true },
    })
    if (!booking) {
      const error = new Error('This booking is not available for payment.')
      error.statusCode = 403
      error.code = 'PAYMENT_BOOKING_FORBIDDEN'
      error.expose = true
      throw error
    }
    if (booking.status !== 'PAYMENT_PENDING') {
      const error = new Error('This booking is not awaiting payment.')
      error.statusCode = 409
      error.code = 'BOOKING_NOT_PAYABLE'
      error.expose = true
      throw error
    }
    requireGuestContactInfo(booking)
    requireStripe()

    const totalMinor = expectedTotalMinor(booking)
    const { currency, unitAmount } = stripeChargeAmount(totalMinor, booking.currency)
    const listingTitle = booking.listing?.titleEn || booking.listing?.titleAr || 'SYBNB stay'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Deliberately no payment_method_types: omitting it enables Stripe's Dynamic Payment
      // Methods, which shows each customer the most relevant eligible methods (configured from
      // the Dashboard) instead of hardcoding to card only.
      line_items: [
        {
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: { name: listingTitle },
          },
          quantity: 1,
        },
      ],
      metadata: {
        bookingId: booking.id,
        guestId: context.user.id,
        bookingTotalMinor: String(totalMinor),
      },
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}#/booking/${booking.id}`,
      cancel_url: `${origin}/#/booking/${booking.id}`,
    })

    return json(res, 201, { ok: true, url: session.url, sessionId: session.id })
  }

  if (url.pathname === '/api/payments/stripe/confirm') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['GUEST'])
    requireStripe()

    const body = await readJson(req)
    const sessionId = String(body.sessionId || '')
    if (!sessionId) {
      const error = new Error('sessionId is required.')
      error.statusCode = 400
      error.code = 'STRIPE_CONFIRM_INPUT_INVALID'
      error.expose = true
      throw error
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (session.metadata?.guestId !== context.user.id) {
      const error = new Error('This payment session does not belong to this account.')
      error.statusCode = 403
      error.code = 'STRIPE_SESSION_FORBIDDEN'
      error.expose = true
      throw error
    }
    if (session.payment_status !== 'paid') {
      const error = new Error('This card payment has not been captured yet.')
      error.statusCode = 409
      error.code = 'STRIPE_PAYMENT_NOT_CAPTURED'
      error.expose = true
      throw error
    }

    const proof = await finalizeStripeSession(session)
    if (!proof) {
      const error = new Error('Could not confirm this payment against the booking.')
      error.statusCode = 409
      error.code = 'STRIPE_CONFIRM_FAILED'
      error.expose = true
      throw error
    }

    return json(res, 200, { ok: true, proof })
  }

  if (url.pathname === '/api/payments/stripe/webhook') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireStripe()
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      const error = new Error('STRIPE_WEBHOOK_SECRET is not configured.')
      error.statusCode = 503
      error.code = 'STRIPE_WEBHOOK_NOT_CONFIGURED'
      error.expose = true
      throw error
    }

    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks)

    let event
    try {
      event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
    } catch {
      const error = new Error('Invalid Stripe webhook signature.')
      error.statusCode = 400
      error.code = 'STRIPE_WEBHOOK_INVALID_SIGNATURE'
      error.expose = true
      throw error
    }

    if (event.type === 'checkout.session.completed') {
      const completed = event.data.object
      if (completed.metadata?.kind === 'wallet_topup') {
        await creditWalletTopupSession(completed) // SR cashless (016): credit rider wallet only on verified paid
      } else {
        await finalizeStripeSession(completed)
      }
    }

    return json(res, 200, { ok: true, received: true })
  }

  // SR cashless card top-up (016): rider picks a BASE credit amount; charged base + 2.35% via Stripe;
  // the wallet is credited the BASE only on the verified webhook (creditWalletTopupSession).
  if (url.pathname === '/api/wallet/topup/stripe-checkout') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const origin = String(body.origin || '').replace(/\/$/, '')
    const baseMinor = Number(body.baseMinor ?? body.amountMinor)
    if (!origin) {
      const error = new Error('origin is required.')
      error.statusCode = 400
      error.code = 'STRIPE_SESSION_INPUT_INVALID'
      error.expose = true
      throw error
    }
    assertAllowedOrigin(origin)
    requireStripe()
    if (!Number.isInteger(baseMinor) || baseMinor <= 0) {
      const error = new Error('Top-up amount must be a whole number greater than zero.')
      error.statusCode = 400
      error.code = 'TOPUP_AMOUNT_INVALID'
      error.expose = true
      throw error
    }
    if (baseMinor > WALLET_TOPUP_MAX_MINOR) {
      const error = new Error('Top-up amount exceeds the maximum allowed per transaction.')
      error.statusCode = 400
      error.code = 'TOPUP_AMOUNT_TOO_HIGH'
      error.expose = true
      throw error
    }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Deliberately no payment_method_types -- see the matching comment in
      // create-checkout-session above.
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: cardTopupChargeCents(baseMinor),
          product_data: { name: `SYBNB wallet credit ($${baseMinor})` },
        },
        quantity: 1,
      }],
      metadata: {
        kind: 'wallet_topup',
        userId: context.user.id,
        baseMinor: String(baseMinor),
        feeMinor: String(cardTopupFeeMinor(baseMinor)),
        currency: 'USD',
      },
      success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}#/wallet`,
      cancel_url: `${origin}/#/wallet`,
    })
    return json(res, 201, { ok: true, url: session.url, sessionId: session.id })
  }

  if (url.pathname === '/api/payments/stripe/status') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    return json(res, 200, {
      ok: true,
      configured: Boolean(stripe),
      currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
    })
  }

  if (url.pathname === '/api/payments/seller-plan-proof') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const body = await readJson(req)

    // SECURITY (S6): the plan fee is a SERVER-SIDE price keyed by planCode — NEVER taken from the request.
    // Otherwise a user could POST amountMinor:1 and, once an admin approves the proof, unlock a paid plan
    // for one unit. Amounts are whole currency units (see currency.mjs), so the published plans (plus $19,
    // premium $49) are 19 / 49; platform-sale has no upfront fee (commission on close instead).
    const SELLER_PLAN_PRICE_MINOR = { plus: 19, premium: 49, 'platform-sale': 0 }
    const planCode = body.planCode ? String(body.planCode).trim() : undefined
    if (!planCode || !Object.prototype.hasOwnProperty.call(SELLER_PLAN_PRICE_MINOR, planCode)) {
      const error = new Error('A valid plan must be selected.')
      error.statusCode = 400
      error.code = 'PLAN_CODE_INVALID'
      error.expose = true
      throw error
    }
    const amountMinor = SELLER_PLAN_PRICE_MINOR[planCode]

    const providerRef = body.providerRef ? String(body.providerRef).trim() : ''
    if (!providerRef) {
      const error = new Error('Transaction reference is required.')
      error.statusCode = 400
      error.code = 'PAYMENT_REFERENCE_REQUIRED'
      error.expose = true
      throw error
    }

    const duplicate = await db().paymentProof.findFirst({
      where: { provider: 'seller_plan', providerRef },
    })
    if (duplicate) {
      const error = new Error('This transaction reference was already submitted.')
      error.statusCode = 409
      error.code = 'PAYMENT_REFERENCE_DUPLICATE'
      error.expose = true
      throw error
    }

    const legalName = body.legalName ? String(body.legalName).trim() : context.user.displayName
    const sellerType = body.sellerType ? String(body.sellerType).trim() : 'owner'

    const [proof] = await db().$transaction([
      db().paymentProof.create({
        data: {
          userId: context.user.id,
          provider: 'seller_plan',
          status: 'PENDING_ADMIN_REVIEW',
          amountMinor,
          currency: 'USD', // MKT-4: plan prices are a USD server table; never take the currency from the client
          proofAssetUrl: body.proofAssetUrl || undefined,
          providerRef,
        },
      }),
      db().sellerProfile.upsert({
        where: { userId: context.user.id },
        create: { userId: context.user.id, legalName, sellerType, planCode, documentStatus: 'PENDING_REVIEW' },
        update: { legalName, sellerType, planCode, documentStatus: 'PENDING_REVIEW' },
      }),
    ])

    return json(res, 201, { ok: true, proof })
  }

  if (url.pathname === '/api/payments/local-wallet-proof') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

    requireAuth(context)
    const body = await readJson(req)
    const booking = body.bookingId
      ? await db().booking.findFirst({
          where: {
            id: body.bookingId,
            guestId: context.user.id,
          },
          include: { listing: true },
        })
      : null

    if (body.bookingId && !booking) {
      const error = new Error('This booking is not available for payment proof upload.')
      error.statusCode = 403
      error.code = 'PAYMENT_BOOKING_FORBIDDEN'
      error.expose = true
      throw error
    }
    // SECURITY (S3b): a proof may only be submitted for a booking still awaiting payment. Without this,
    // a guest could submit a second proof on an already-CONFIRMED/COMPLETED booking and, once approved,
    // trigger a duplicate host payout + commission credit.
    if (booking && booking.status !== 'PAYMENT_PENDING') {
      const error = new Error('This booking is not awaiting payment.')
      error.statusCode = 409
      error.code = 'BOOKING_NOT_AWAITING_PAYMENT'
      error.expose = true
      throw error
    }
    // Only bookingId-tied proofs (an actual STR-style booking) require contact info -- proofs
    // with no bookingId (e.g. a seller-plan payment) aren't tied to a booking to attach it to.
    if (booking) requireGuestContactInfo(booking)
    // Default to the FULL amount due (stay + fees), matching the S11 floor below and the Stripe path —
    // a guest who submits a proof without naming an amount is paying the whole booking, not the bare stay.
    const amountMinor = Number(body.amountMinor || (booking ? expectedTotalMinor(booking) : 0))
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      const error = new Error('Payment proof amount must be greater than zero.')
      error.statusCode = 400
      error.code = 'PAYMENT_AMOUNT_INVALID'
      error.expose = true
      throw error
    }

    // SECURITY (S11): the floor is the FULL expected total (stay + cleaning + tax + protection), the same
    // amount the Stripe path charges — not the bare stay. Otherwise a wallet guest could underpay the
    // platform fees that a card guest pays for an identical stay.
    if (booking && amountMinor < expectedTotalMinor(booking)) {
      const error = new Error('Payment proof amount is lower than the amount due for this booking.')
      error.statusCode = 400
      error.code = 'PAYMENT_AMOUNT_TOO_LOW'
      error.expose = true
      throw error
    }

    const providerRef = body.providerRef ? String(body.providerRef).trim() : ''
    if (!providerRef) {
      const error = new Error('Syrian wallet transaction reference is required.')
      error.statusCode = 400
      error.code = 'PAYMENT_REFERENCE_REQUIRED'
      error.expose = true
      throw error
    }

    const duplicate = await db().paymentProof.findFirst({
      where: {
        provider: 'syrian_local_wallet',
        providerRef,
      },
    })

    if (duplicate) {
      const error = new Error('This wallet transaction reference was already submitted.')
      error.statusCode = 409
      error.code = 'PAYMENT_REFERENCE_DUPLICATE'
      error.expose = true
      throw error
    }

    const proof = await db().paymentProof.create({
      data: {
        bookingId: booking?.id || undefined,
        userId: context.user.id,
        provider: 'syrian_local_wallet',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor,
        currency: booking?.currency || body.currency || 'SYP',
        proofAssetUrl: body.proofAssetUrl || undefined,
        providerRef,
      },
    })

    return json(res, 201, { ok: true, proof })
  }

  const paymentMatch = url.pathname.match(/^\/api\/payments\/([^/]+)$/)
  if (paymentMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const proof = await db().paymentProof.findUnique({
      where: { id: paymentMatch[1] },
      include: {
        booking: {
          include: {
            guest: {
              select: {
                id: true,
                displayName: true,
              },
            },
            listing: {
              include: {
                owner: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!proof) {
      const error = new Error('Payment proof not found.')
      error.statusCode = 404
      error.code = 'PAYMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const ownerId = proof.booking?.listing?.ownerId
    const guestId = proof.booking?.guestId
    const isAllowed =
      context.roles.includes('ADMIN') ||
      context.roles.includes('SUPPORT') ||
      proof.userId === context.user.id ||
      guestId === context.user.id ||
      ownerId === context.user.id

    if (!isAllowed) {
      const error = new Error('This payment proof is not available for this account.')
      error.statusCode = 403
      error.code = 'PAYMENT_FORBIDDEN'
      error.expose = true
      throw error
    }

    // SECURITY (S7): the listing owner (host) may confirm a proof exists and its status/amount, but must
    // NOT see the guest's uploaded transfer screenshot or internal admin fields. Only the uploader/guest
    // and admins/support receive the full proof.
    const isPrivileged =
      context.roles.includes('ADMIN') ||
      context.roles.includes('SUPPORT') ||
      proof.userId === context.user.id ||
      guestId === context.user.id
    const safeProof = isPrivileged
      ? proof
      : { ...proof, proofAssetUrl: undefined, adminNote: undefined, reviewedById: undefined, providerRef: undefined }

    return json(res, 200, { ok: true, proof: safeProof })
  }

  return false
}
