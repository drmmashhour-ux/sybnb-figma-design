// Wallet-gift money movement (money-conservation fix). A gift is a transfer, not a mint: the sender is
// DEBITED the moment the gift is sent (reserving the money), the recipient is CREDITED on claim, and the
// sender is REFUNDED on every non-claimed terminal state (expiry, admin block). Every entry is keyed on
// the gift id via the ledger's unique idempotency key, so no transition can double-move money — a refund
// can fire from several expiry paths (lazy claim-time, GET /api/wallet sweep, profile sweep) and only the
// first one actually credits.
import { recordWalletEntry } from './finance-ledger.mjs'

// Debit the sender at send time — reserves the gift amount out of their wallet immediately, whether the
// gift went straight to SENT (<100k) or is held at CLAIM_PENDING (>=100k) awaiting admin review.
export async function debitGiftFromSender(tx, gift) {
  return recordWalletEntry(tx, {
    userId: gift.senderUserId,
    type: 'DEBIT',
    amountMinor: gift.amountMinor,
    currency: gift.currency,
    referenceType: 'wallet_gift_send',
    referenceId: gift.id,
    keyParts: ['gift-fund', gift.id],
    note: 'Gift sent — reserved from wallet',
  })
}

// Refund the sender when a gift ends in any non-claimed terminal state. Idempotent on the gift id: the
// ledger's unique key means a second refund attempt (e.g. two expiry sweeps racing) returns the existing
// entry and moves no money.
export async function refundGiftToSender(tx, gift) {
  return recordWalletEntry(tx, {
    userId: gift.senderUserId,
    type: 'REFUND',
    amountMinor: gift.amountMinor,
    currency: gift.currency,
    referenceType: 'wallet_gift_refund',
    referenceId: gift.id,
    keyParts: ['gift-refund', gift.id],
    note: 'Gift refunded to sender — not claimed',
  })
}

// Opportunistic expire-and-refund sweep, run on the SENDER's own reads (GET /api/wallet, profile load),
// mirroring how bookings expire lazily on access. Flips this sender's past-expiry SENT/CLAIM_PENDING gifts
// to EXPIRED and refunds each. The per-gift status-claim (updateMany matching only the still-live states)
// plus the refund's idempotency key make it safe to run on every read and under concurrency: a gift that
// was already expired/claimed elsewhere matches zero rows and is skipped.
export async function expireAndRefundSenderGifts(client, senderUserId) {
  const now = new Date()
  const stale = await client.walletGift.findMany({
    where: { senderUserId, status: { in: ['SENT', 'CLAIM_PENDING'] }, expiresAt: { lt: now } },
  })
  for (const gift of stale) {
    await client.$transaction(async (tx) => {
      const claimed = await tx.walletGift.updateMany({
        where: { id: gift.id, status: { in: ['SENT', 'CLAIM_PENDING'] } },
        data: { status: 'EXPIRED' },
      })
      if (claimed.count === 1) {
        await refundGiftToSender(tx, gift)
      }
    })
  }
}
