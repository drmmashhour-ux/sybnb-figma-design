import { db, disconnectDb } from '../server/lib/prisma.mjs'
import { bookingFinanceSplit, recordWalletEntry } from '../server/lib/finance-ledger.mjs'

const bookingId = process.env.BOOKING_ID
const strPlanProofId = process.env.STR_PLAN_PROOF_ID
const apply = process.env.APPLY === 'true'

if (!bookingId || !strPlanProofId) {
  throw new Error('BOOKING_ID and STR_PLAN_PROOF_ID are required.')
}

async function inspect(tx) {
  const admin = await tx.user.findFirst({
    where: { roles: { some: { role: 'ADMIN' } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  })
  if (!admin) throw new Error('No ADMIN platform account exists.')

  const bookingProof = await tx.paymentProof.findFirst({
    where: { bookingId, provider: 'stripe', status: 'APPROVED' },
    orderBy: { createdAt: 'asc' },
    include: { booking: { include: { listing: true } } },
  })
  if (!bookingProof?.booking) throw new Error('Approved Stripe booking proof was not found.')

  const strPlanProof = await tx.paymentProof.findUnique({ where: { id: strPlanProofId } })
  if (!strPlanProof || strPlanProof.provider !== 'str_host_plan' || strPlanProof.status !== 'APPROVED') {
    throw new Error('Approved STR host-plan proof was not found.')
  }

  const split = bookingFinanceSplit(bookingProof.booking, bookingProof.amountMinor)
  const existingBookingCredit = await tx.walletEntry.findFirst({
    where: { type: 'CREDIT', referenceType: 'booking_admin_share', referenceId: bookingId },
  })
  const existingPlanCredit = await tx.walletEntry.findFirst({
    where: { type: 'CREDIT', referenceType: 'str_host_plan_fee', referenceId: strPlanProofId },
  })

  return { admin, bookingProof, strPlanProof, split, existingBookingCredit, existingPlanCredit }
}

try {
  const preview = await inspect(db())
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    adminEmail: preview.admin.email,
    bookingAdminShareMinor: preview.split.adminShareMinor,
    bookingCurrency: preview.bookingProof.currency,
    bookingCreditExists: Boolean(preview.existingBookingCredit),
    strPlanFeeMinor: preview.strPlanProof.amountMinor,
    strPlanCurrency: preview.strPlanProof.currency,
    strPlanCreditExists: Boolean(preview.existingPlanCredit),
  }, null, 2))

  if (!apply) process.exitCode = 0
  else {
    const result = await db().$transaction(async (tx) => {
      const state = await inspect(tx)
      const created = []

      if (!state.existingBookingCredit) {
        const entry = await recordWalletEntry(tx, {
          userId: state.admin.id,
          type: 'CREDIT',
          amountMinor: state.split.adminShareMinor,
          currency: state.bookingProof.currency,
          referenceType: 'booking_admin_share',
          referenceId: bookingId,
          keyParts: ['booking-admin-share', bookingId, state.bookingProof.id, state.admin.id],
          note: 'Backfilled SYBNB/admin share after staging accounting-account remediation.',
        })
        if (entry) created.push({ kind: 'booking_admin_share', entryId: entry.id })
      }

      if (!state.existingPlanCredit) {
        const entry = await recordWalletEntry(tx, {
          userId: state.admin.id,
          type: 'CREDIT',
          amountMinor: state.strPlanProof.amountMinor,
          currency: state.strPlanProof.currency,
          referenceType: 'str_host_plan_fee',
          referenceId: state.strPlanProof.id,
          keyParts: ['str-host-plan-fee', state.strPlanProof.id, state.admin.id],
          note: 'Backfilled SYBNB STR host-plan revenue after staging accounting-account remediation.',
        })
        if (entry) created.push({ kind: 'str_host_plan_fee', entryId: entry.id })
      }

      if (created.length) {
        await tx.adminAuditLog.create({
          data: {
            actorUserId: state.admin.id,
            action: 'PLATFORM_REVENUE_LEDGER_BACKFILLED',
            entityType: 'payment_proofs',
            entityId: state.bookingProof.id,
            before: {
              bookingAdminSharePresent: Boolean(state.existingBookingCredit),
              strPlanFeePresent: Boolean(state.existingPlanCredit),
            },
            after: { bookingId, strPlanProofId, created },
          },
        })
      }

      return created
    })
    console.log(JSON.stringify({ created: result }, null, 2))
  }
} finally {
  await disconnectDb()
}
