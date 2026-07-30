import Stripe from 'stripe'
import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, recordWalletEntry, CANCELLATION_PROTECTION_RATE, STR_CLEANING_RATE, STR_TAX_RATE } from '../lib/finance-ledger.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { savePaymentProofFile, readPaymentProofFile } from '../lib/payment-proof-storage.mjs'

// timeout/maxNetworkRetries bound how long a Stripe call can block the request: the Stripe SDK default
// (~80s) exceeds the Vercel function maxDuration (30s), so a slow Stripe response would run the whole
// budget then 504. 8s + one retry fails fast and cheap instead of burning function time.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 8000, maxNetworkRetries: 1 }) : null

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

// Mirrors the client-side gate in BookingDetailPage.tsx (`hasIdDocument =
// Boolean(booking?.guest?.idDocumentRef)`) -- that gate only hid the payment buttons in the UI,
// it was never actually checked here, so any authenticated guest could pay for a booking via a
// direct API call without ever uploading an ID document. Only requires the document to have been
// uploaded (idDocumentRef set), not yet reviewed/approved -- review happens asynchronously via the
// admin queue, same as the client-side condition.
function requireIdDocumentUploaded(user) {
  if (!user.idDocumentRef) {
    const error = new Error('Upload an ID document before paying for this booking.')
    error.statusCode = 403
    error.code = 'ID_VERIFICATION_REQUIRED'
    error.expose = true
    throw error
  }
}

function metadataNumber(metadata, key) {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

// Mirrors src/modules/bookings/guestFeeSummary.ts so the Stripe charge matches what the guest saw.
function expectedTotalMinor(booking) {
  const stayAmountMinor = Math.max(0, Math.round(booking.amountMinor || 0))
  const listingMetadata = booking.listing?.metadata || {}
  const bookingMetadata = booking.metadata || {}
  const isShortStay = !booking.listing || booking.listing.division === 'STAYS'

  const cleaningFeeMinor = metadataNumber(listingMetadata, 'cleaningFeeMinor') || (isShortStay ? Math.round(stayAmountMinor * STR_CLEANING_RATE) : 0)
  const taxesMinor = metadataNumber(listingMetadata, 'taxesMinor') || (isShortStay ? Math.round(stayAmountMinor * STR_TAX_RATE) : 0)
  const extraFeesMinor = metadataNumber(listingMetadata, 'extraFeesMinor')
  const cancellationProtectionPurchased = bookingMetadata.cancellationProtectionPurchased === true
  const cancellationProtectionFeeMinor = cancellationProtectionPurchased
    ? metadataNumber(bookingMetadata, 'cancellationProtectionFeeMinor') || Math.round(stayAmountMinor * CANCELLATION_PROTECTION_RATE)
    : 0

  return stayAmountMinor + cleaningFeeMinor + taxesMinor + extraFeesMinor + cancellationProtectionFeeMinor
}

// SYP is not a Stripe-supported settlement currency, so test-mode charges run in STRIPE_CURRENCY
// (USD by default) using a configurable placeholder rate. Swap SYP_PER_USD for a live FX feed
// before this ever handles real money.
function stripeChargeAmount(totalMinor) {
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase()
  if (currency === 'syp') return { currency, unitAmount: Math.max(100, Math.round(totalMinor)) }
  const sypPerUsd = Number(process.env.SYP_PER_USD || 15000)
  const unitAmount = Math.max(50, Math.round((totalMinor / sypPerUsd) * 100))
  return { currency, unitAmount }
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

export async function finalizeStripeSession(session) {
  // A wallet top-up is credited exclusively by creditWalletTopupSession() from the webhook — never here.
  if (session.metadata?.kind === 'wallet_topup') return null
  // STR host listing-plan card payments finalize through their own path (isolated from bookings).
  if (session.metadata?.purpose === 'str_host_plan') return finalizeStripeStrPlanSession(session)
  const bookingId = session.metadata?.bookingId
  if (!bookingId || session.payment_status !== 'paid') return null

  return db().$transaction(async (tx) => {
    const existingProof = await tx.paymentProof.findFirst({
      where: { provider: 'stripe', providerRef: session.id },
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
        amountMinor: Number(session.metadata?.sypTotalMinor || booking.amountMinor),
        currency: booking.currency,
        providerRef: session.id,
        proofAssetUrl: session.payment_intent ? `stripe://payment_intents/${session.payment_intent}` : undefined,
      },
    })

    const actorUserId = await firstAdminId(tx)
    const approved = await approvePaymentProof(tx, {
      proofId: created.id,
      actorUserId,
      note: 'Auto-approved: Stripe confirmed the card charge was captured.',
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

// STR daily-stay host listing-plan prices (USD whole units). SERVER-SIDE source of truth — the Stripe
// plan charge is keyed by planCode and NEVER taken from the client (S6). Mirrors the wizard's displayed
// prices (HOST_LISTING_PLANS in src/modules/seller/SellerListingWizard.tsx). Isolated from the
// marketplace SELLER_PLAN_PRICE_MINOR table used by /api/payments/seller-plan-proof.
export const STR_HOST_PLAN_PRICE_MINOR = { basic: 9, plus: 19, premium: 49, hotel: 100 }

// Finalize an STR host listing-plan CARD payment. Acts only on a captured ('paid') session whose
// metadata.purpose is 'str_host_plan'. Idempotent on the Stripe session id, so a retried / out-of-order
// webhook (or a confirm racing the webhook) records the plan fee exactly once. Revenue is booked by
// approvePaymentProof's `str_host_plan` branch — 100% platform, and deliberately WITHOUT any
// sellerProfile write, so it never unlocks marketplace/dealer selling the way `seller_plan` does.
export async function finalizeStripeStrPlanSession(session) {
  if (session.metadata?.purpose !== 'str_host_plan' || session.payment_status !== 'paid') return null
  const userId = session.metadata?.userId
  const planCode = session.metadata?.planCode
  const amountMinor = Number(session.metadata?.planPriceUsdMinor)
  if (!userId || !planCode || !Number.isFinite(amountMinor) || amountMinor <= 0) return null

  return db().$transaction(async (tx) => {
    const existingProof = await tx.paymentProof.findFirst({
      where: { provider: 'str_host_plan', providerRef: session.id },
    })
    if (existingProof) return existingProof

    const created = await tx.paymentProof.create({
      data: {
        userId,
        provider: 'str_host_plan',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor,
        currency: 'USD',
        providerRef: session.id,
        proofAssetUrl: session.payment_intent ? `stripe://payment_intents/${session.payment_intent}` : undefined,
      },
    })

    const actorUserId = await firstAdminId(tx)
    const approved = await approvePaymentProof(tx, {
      proofId: created.id,
      actorUserId,
      note: 'Auto-approved: Stripe confirmed the STR host plan fee was captured.',
    })

    await tx.adminAuditLog.create({
      data: {
        actorUserId: actorUserId || null,
        action: 'STRIPE_STR_PLAN_AUTO_APPROVED',
        entityType: 'payment_proofs',
        entityId: approved.id,
        before: { status: created.status, provider: created.provider, providerRef: created.providerRef },
        after: { status: approved.status, provider: approved.provider, providerRef: approved.providerRef, planCode, stripeSessionId: session.id },
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
    // ID-verification gate runs BEFORE the Stripe-config check so an unverified guest gets a clear
    // 403 ID_VERIFICATION_REQUIRED rather than a 503 about Stripe not being configured.
    requireIdDocumentUploaded(context.user)
    requireStripe()

    const totalMinor = expectedTotalMinor(booking)
    const { currency, unitAmount } = stripeChargeAmount(totalMinor)
    const listingTitle = booking.listing?.titleEn || booking.listing?.titleAr || 'SYBNB stay'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
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
        sypTotalMinor: String(totalMinor),
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

  // STR host listing-plan CARD checkout (host pays the plan fee mid-wizard). Isolated from the
  // marketplace /seller-plan-proof flow; charges the server-side price for the plan code in USD.
  if (url.pathname === '/api/payments/stripe/create-str-plan-checkout-session') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    requireStripe()

    const body = await readJson(req)
    const planCode = body.planCode ? String(body.planCode).trim() : ''
    const origin = String(body.origin || '').replace(/\/$/, '')
    if (!origin) {
      const error = new Error('origin is required.')
      error.statusCode = 400
      error.code = 'STRIPE_SESSION_INPUT_INVALID'
      error.expose = true
      throw error
    }
    if (!Object.prototype.hasOwnProperty.call(STR_HOST_PLAN_PRICE_MINOR, planCode)) {
      const error = new Error('A valid plan must be selected.')
      error.statusCode = 400
      error.code = 'PLAN_CODE_INVALID'
      error.expose = true
      throw error
    }
    // SECURITY (S6): amount is looked up by planCode server-side, never taken from the request.
    const amountMinor = STR_HOST_PLAN_PRICE_MINOR[planCode]
    if (amountMinor <= 0) {
      const error = new Error('This plan has no card fee.')
      error.statusCode = 400
      error.code = 'PLAN_NOT_PAYABLE'
      error.expose = true
      throw error
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd', // STR host plans are priced in USD whole units — charge USD directly (not SYP).
          unit_amount: amountMinor * 100,
          product_data: { name: `SYBNB host plan (${planCode})` },
        },
        quantity: 1,
      }],
      metadata: {
        purpose: 'str_host_plan',
        userId: context.user.id,
        planCode,
        planPriceUsdMinor: String(amountMinor),
      },
      success_url: `${origin}/?str_plan_session_id={CHECKOUT_SESSION_ID}#/sell/listing-wizard`,
      cancel_url: `${origin}/#/sell/listing-wizard`,
    })

    return json(res, 201, { ok: true, url: session.url, sessionId: session.id })
  }

  if (url.pathname === '/api/payments/stripe/confirm-str-plan') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
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
    if (session.metadata?.purpose !== 'str_host_plan' || session.metadata?.userId !== context.user.id) {
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

    const proof = await finalizeStripeStrPlanSession(session)
    if (!proof) {
      const error = new Error('Could not confirm this plan payment.')
      error.statusCode = 409
      error.code = 'STRIPE_CONFIRM_FAILED'
      error.expose = true
      throw error
    }

    return json(res, 200, { ok: true, proof, planCode: session.metadata?.planCode })
  }

  // Sham Cash STR host-plan payment proof: the host uploads a receipt of the manual transfer. UNLIKE
  // the card path (auto-approved because Stripe already captured the charge), this creates a PENDING
  // proof the admin verifies against the uploaded file, then approves — which records the plan revenue
  // via the str_host_plan branch in approvePaymentProof (finance-ledger.mjs).
  if (url.pathname === '/api/payments/str-plan-sham-proof') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)

    const body = await readJson(req)
    const planCode = body.planCode ? String(body.planCode).trim() : ''
    const providerRef = body.providerRef ? String(body.providerRef).trim() : ''
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''

    if (!Object.prototype.hasOwnProperty.call(STR_HOST_PLAN_PRICE_MINOR, planCode)) {
      const error = new Error('A valid plan must be selected.')
      error.statusCode = 400
      error.code = 'PLAN_CODE_INVALID'
      error.expose = true
      throw error
    }
    if (!providerRef) {
      const error = new Error('Transaction reference is required.')
      error.statusCode = 400
      error.code = 'PAYMENT_REFERENCE_REQUIRED'
      error.expose = true
      throw error
    }
    if (!fileBase64 || !mimeType) {
      const error = new Error('A payment proof file is required.')
      error.statusCode = 400
      error.code = 'PAYMENT_PROOF_REQUIRED'
      error.expose = true
      throw error
    }
    // SECURITY (S6): amount is the server-table price for the plan code, never taken from the request.
    const amountMinor = STR_HOST_PLAN_PRICE_MINOR[planCode]

    const duplicate = await db().paymentProof.findFirst({ where: { provider: 'str_host_plan', providerRef } })
    if (duplicate) {
      const error = new Error('This transaction reference was already submitted.')
      error.statusCode = 409
      error.code = 'PAYMENT_REFERENCE_DUPLICATE'
      error.expose = true
      throw error
    }

    const proof = await db().$transaction(async (tx) => {
      const created = await tx.paymentProof.create({
        data: {
          userId: context.user.id,
          provider: 'str_host_plan',
          status: 'PENDING_ADMIN_REVIEW',
          amountMinor,
          currency: 'USD',
          providerRef,
        },
      })
      // Persist the receipt bytes in the DB (validated for type/size), then point proofAssetUrl at the
      // admin-only file endpoint now that we have the proof id.
      await savePaymentProofFile(tx, created.id, fileBase64, mimeType)
      return tx.paymentProof.update({
        where: { id: created.id },
        data: { proofAssetUrl: `/api/payments/str-plan-sham-proof/${created.id}/file` },
      })
    })

    return json(res, 201, { ok: true, proof })
  }

  // Admin-only: stream the stored receipt bytes for a plan-payment proof so an admin can verify it.
  const strPlanProofFileMatch = url.pathname.match(/^\/api\/payments\/str-plan-sham-proof\/([^/]+)\/file$/)
  if (strPlanProofFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const file = await readPaymentProofFile(strPlanProofFileMatch[1])
    if (!file) {
      const error = new Error('No payment proof file found.')
      error.statusCode = 404
      error.code = 'PAYMENT_PROOF_NOT_FOUND'
      error.expose = true
      throw error
    }
    res.writeHead(200, { 'content-type': file.mimeType || 'application/octet-stream', 'cache-control': 'private, no-store' })
    res.end(file.data)
    return true
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
    requireStripe()
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
      payment_method_types: ['card'],
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
    if (booking) requireIdDocumentUploaded(context.user)

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
