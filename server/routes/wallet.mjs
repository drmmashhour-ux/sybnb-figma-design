import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { hashPhone, idempotencyKey, verifyGiftClaimCode } from '../lib/security.mjs'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { roundUsdUpToStep } from '../lib/currency.mjs'
import { riderAvailableBalanceMinor } from '../lib/sr-payments.mjs'
import { lockWalletForSpend } from '../lib/finance-ledger.mjs'
import { debitGiftFromSender, refundGiftToSender, expireAndRefundSenderGifts } from '../lib/gift-ledger.mjs'

// SR cashless top-up (016): sane per-top-up ceiling (whole currency units).
const WALLET_TOPUP_MAX_MINOR = 100_000_000
const WALLET_TOPUP_CURRENCIES = new Set(['SYP', 'USD'])

export async function handleWallet(req, res, url, context) {
  // SR cashless top-up (016): Sham Cash refill. 1:1, no fee — credited by approvePaymentProof on admin
  // approval. The pending proof auto-appears in the admin review queue (provider contains SHAM →
  // reconciliation guard applies). Card top-up lives in payments.mjs (/api/wallet/topup/stripe-checkout).
  if (url.pathname === '/api/wallet/topup/sham-cash') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const amountMinor = Number(body.amountMinor)
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      const error = new Error('Top-up amount must be a whole number greater than zero.')
      error.statusCode = 400
      error.code = 'TOPUP_AMOUNT_INVALID'
      error.expose = true
      throw error
    }
    if (amountMinor > WALLET_TOPUP_MAX_MINOR) {
      const error = new Error('Top-up amount exceeds the maximum allowed per transaction.')
      error.statusCode = 400
      error.code = 'TOPUP_AMOUNT_TOO_HIGH'
      error.expose = true
      throw error
    }
    const currency = WALLET_TOPUP_CURRENCIES.has(body.currency) ? body.currency : 'SYP'
    const providerRef = body.providerRef ? String(body.providerRef).trim() : ''
    if (!providerRef) {
      const error = new Error('Sham Cash transaction reference is required.')
      error.statusCode = 400
      error.code = 'PAYMENT_REFERENCE_REQUIRED'
      error.expose = true
      throw error
    }
    const duplicate = await db().paymentProof.findFirst({ where: { provider: 'wallet_topup_sham_cash', providerRef } })
    if (duplicate) {
      const error = new Error('This Sham Cash transaction reference was already submitted.')
      error.statusCode = 409
      error.code = 'PAYMENT_REFERENCE_DUPLICATE'
      error.expose = true
      throw error
    }
    const proof = await db().paymentProof.create({
      data: {
        userId: context.user.id,
        provider: 'wallet_topup_sham_cash',
        status: 'PENDING_ADMIN_REVIEW',
        amountMinor,
        currency,
        proofAssetUrl: body.proofAssetUrl || undefined,
        providerRef,
      },
    })
    return json(res, 201, { ok: true, proof })
  }

  if (url.pathname === '/api/wallet') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    // Opportunistic expire-and-refund sweep, mirroring me.mjs's completeExpiredBookings: a gift this
    // caller sent that lapsed its expiresAt without being claimed is flipped to EXPIRED and refunded
    // here, so their reserved money returns the next time they look at their own wallet.
    await expireAndRefundSenderGifts(db(), context.user.id)
    // A guest can hold more than one currency's wallet (SYP is the default, USD is opened
    // lazily the first time a USD gift/payment is received — see recordWalletEntry's upsert).
    // Previously this only ever queried the SYP wallet, so a real USD balance/gift history was
    // silently invisible on this page.
    const wallets = await db().wallet.findMany({
      where: { userId: context.user.id },
      include: { entries: { orderBy: { createdAt: 'desc' }, take: 25 } },
      orderBy: { currency: 'asc' },
    })
    return json(res, 200, { ok: true, wallets })
  }

  if (url.pathname === '/api/wallet/gifts') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const rawAmountMinor = Number(body.amountMinor || 0)
    if (!Number.isFinite(rawAmountMinor) || rawAmountMinor <= 0) {
      const error = new Error('Gift amount must be greater than zero.')
      error.statusCode = 400
      error.code = 'GIFT_AMOUNT_INVALID'
      error.expose = true
      throw error
    }

    const currency = body.currency === 'USD' ? 'USD' : 'SYP'
    // Enforced server-side, not just in the UI: a USD gift always rounds up to the nearest $5 so
    // neither side needs to make change, regardless of what a client actually submitted.
    const amountMinor = currency === 'USD' ? roundUsdUpToStep(rawAmountMinor) : rawAmountMinor

    // A gift is a transfer, not a mint: a sender cannot gift to their own phone (would trivially shuffle
    // money to dodge per-account checks, and is nonsensical). recipientPhoneHash uses the same HMAC as
    // the account's own phoneHash, so equal hashes mean the same number.
    const recipientPhoneHash = hashPhone(body.recipientPhone)
    if (context.user.phoneHash && recipientPhoneHash === context.user.phoneHash) {
      const error = new Error('You cannot send a gift to your own account.')
      error.statusCode = 400
      error.code = 'GIFT_SELF_NOT_ALLOWED'
      error.expose = true
      throw error
    }

    // MONEY CONSERVATION: reserve (DEBIT) the amount from the sender at send time, gated on their
    // *available* balance (cached minus anything already reserved for an in-flight SR ride — reused via
    // riderAvailableBalanceMinor), so the same money can't be both held for a ride and gifted away. The
    // recipient is credited on claim; the sender is refunded on any non-claimed terminal state. Create +
    // debit run in one transaction so a gift row can never exist without its matching sender DEBIT.
    const gift = await db().$transaction(async (tx) => {
      // Serialize concurrent spends on the sender's wallet before the available-balance check, so two
      // simultaneous gifts (or a gift racing an SR charge) can't both pass on the same balance.
      await lockWalletForSpend(tx, context.user.id, currency)
      const available = await riderAvailableBalanceMinor(tx, { riderId: context.user.id, currency, excludeRideId: null })
      if (available < amountMinor) {
        const error = new Error('Your wallet balance is not enough to send this gift.')
        error.statusCode = 402
        error.code = 'INSUFFICIENT_CREDIT'
        error.expose = true
        throw error
      }
      const created = await tx.walletGift.create({
        data: {
          senderUserId: context.user.id,
          recipientPhoneHash,
          amountMinor,
          currency,
          message: body.message || undefined,
          status: amountMinor >= 100000 ? 'CLAIM_PENDING' : 'SENT',
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        },
      })
      await debitGiftFromSender(tx, created)
      return created
    })
    return json(res, 201, { ok: true, gift })
  }

  const giftPreviewMatch = url.pathname.match(/^\/api\/wallet\/gifts\/([^/]+)$/)
  if (giftPreviewMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context)
    const gift = await db().walletGift.findUnique({
      where: { id: giftPreviewMatch[1] },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    })

    if (!gift) {
      const error = new Error('Gift was not found.')
      error.statusCode = 404
      error.code = 'GIFT_NOT_FOUND'
      error.expose = true
      throw error
    }

    // PRIVACY (L1): a gift's amount, message and parties are private to the two people involved. Only
    // the sender, or the intended recipient (matched by claimed recipientUserId or by the recipient
    // phone hash), may preview it. Anyone else gets the same 404 as a non-existent gift, so an
    // unrelated authenticated user can't confirm a gift id exists, let alone read its details.
    const viewer = context.user
    const isSender = gift.senderUserId === viewer.id
    const isRecipient =
      (gift.recipientUserId && gift.recipientUserId === viewer.id) ||
      (viewer.phoneHash && viewer.phoneHash === gift.recipientPhoneHash)
    if (!isSender && !isRecipient) {
      const error = new Error('Gift was not found.')
      error.statusCode = 404
      error.code = 'GIFT_NOT_FOUND'
      error.expose = true
      throw error
    }

    return json(res, 200, {
      ok: true,
      gift: {
        id: gift.id,
        senderUserId: gift.senderUserId,
        recipientUserId: gift.recipientUserId,
        amountMinor: gift.amountMinor,
        currency: gift.currency,
        message: gift.message,
        status: gift.status,
        expiresAt: gift.expiresAt,
        createdAt: gift.createdAt,
        updatedAt: gift.updatedAt,
        sender: gift.sender,
      },
    })
  }

  const claimMatch = url.pathname.match(/^\/api\/wallet\/gifts\/([^/]+)\/claim$/)
  if (claimMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context)
    const body = await readJson(req)
    const phoneHash = hashPhone(body.phone)
    const gift = await db().walletGift.findUnique({
      where: { id: claimMatch[1] },
    })

    if (!gift || gift.status !== 'SENT') throw giftClaimError()
    // Lazily expired on access, same pattern as completeExpiredBookings()/expireOldListings()
    // elsewhere in this codebase -- a gift's expiresAt was always shown to the sender/admin and
    // the frontend even has a dedicated "expired" error state, but nothing server-side ever
    // checked it: a gift could be claimed indefinitely past its displayed expiration date.
    if (gift.expiresAt < new Date()) {
      // Refund the sender on the same status-claim that expires the gift (idempotent on the gift id, so a
      // concurrent GET-wallet sweep can't also refund). Money returns to whoever sent it.
      await db().$transaction(async (tx) => {
        const expired = await tx.walletGift.updateMany({ where: { id: gift.id, status: 'SENT' }, data: { status: 'EXPIRED' } })
        if (expired.count === 1) await refundGiftToSender(tx, gift)
      })
      throw giftClaimError('This gift has expired.', 'GIFT_EXPIRED')
    }
    if (gift.recipientPhoneHash !== phoneHash) {
      await registerFailedGiftClaim(gift)
      throw giftClaimError()
    }
    if (gift.lockedUntil && gift.lockedUntil > new Date()) {
      const error = giftClaimError('Gift claim is temporarily locked after too many attempts.', 'GIFT_CLAIM_LOCKED')
      throw error
    }
    if (!verifyGiftClaimCode(gift, body.code)) {
      const updatedGift = await registerFailedGiftClaim(gift)
      if (updatedGift.lockedUntil && updatedGift.lockedUntil > new Date()) {
        throw giftClaimError('Gift claim is temporarily locked after too many attempts.', 'GIFT_CLAIM_LOCKED')
      }
      throw giftClaimError('Verification code is not correct.', 'GIFT_CODE_INVALID')
    }

    const wallet = await db().wallet.upsert({
      where: { userId_currency: { userId: context.user.id, currency: gift.currency } },
      create: { userId: context.user.id, currency: gift.currency, cachedBalanceMinor: 0 },
      update: {},
    })

    // Two different accounts claiming the same gift concurrently (leaked code, recipient logged
    // into two sessions, etc.) would otherwise both pass the SENT check above and both credit a
    // wallet the full amount, since each claim's idempotency key is scoped per-claiming-user and
    // so never collides with the other's. Re-checking status: 'SENT' inside the same transaction
    // as an updateMany makes the row-level lock do the job: the second concurrent transaction's
    // updateMany blocks until the first commits, then matches zero rows.
    const result = await db().$transaction(async (tx) => {
      const claimResult = await tx.walletGift.updateMany({
        where: { id: gift.id, status: 'SENT' },
        data: {
          status: 'CLAIMED',
          recipientUserId: context.user.id,
          claimAttemptCount: 0,
          lockedUntil: null,
        },
      })

      if (claimResult.count === 0) throw giftClaimError()

      const entry = await tx.walletEntry.create({
        data: {
          walletId: wallet.id,
          type: 'CREDIT',
          amountMinor: gift.amountMinor,
          currency: gift.currency,
          referenceType: 'wallet_gift',
          referenceId: gift.id,
          idempotencyKey: idempotencyKey(['gift-claim', gift.id, context.user.id]),
          note: 'Gift claimed into wallet',
        },
      })
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: { cachedBalanceMinor: { increment: gift.amountMinor } },
      })
      const updatedGift = await tx.walletGift.findUnique({ where: { id: gift.id } })

      return [entry, updatedWallet, updatedGift]
    })

    return json(res, 200, { ok: true, entry: result[0], wallet: result[1], gift: result[2] })
  }

  return false
}

async function registerFailedGiftClaim(gift) {
  const nextAttempts = gift.claimAttemptCount + 1
  return db().walletGift.update({
    where: { id: gift.id },
    data: {
      claimAttemptCount: { increment: 1 },
      lockedUntil: nextAttempts >= 3 ? new Date(Date.now() + 1000 * 60 * 10) : gift.lockedUntil,
    },
  })
}

function giftClaimError(message = 'Gift is not claimable for this phone number.', code = 'GIFT_NOT_CLAIMABLE') {
  const error = new Error(message)
  error.statusCode = 403
  error.code = code
  error.expose = true
  return error
}
