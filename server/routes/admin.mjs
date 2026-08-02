import { db } from '../lib/prisma.mjs'
import { requireAuth } from '../lib/auth-context.mjs'
import { approvePaymentProof, bookingFinanceSplit, debitableMinor, lockWalletForSpend, originalAdminShareRecipient, recordWalletEntry } from '../lib/finance-ledger.mjs'
import { completeExpiredBookings, isPayoutEligible, payoutEligibleAt, PAYOUT_HOLD_DAYS } from '../lib/booking-lifecycle.mjs'
import { FREE_TIER_DIVISIONS, freeListingExpiryDate, listingExpiryDate, PAID_PLAN_DIVISIONS } from '../lib/listing-lifecycle.mjs'
import { assertVehicleEligible, computeDriverStanding } from '../lib/fleet.mjs'
import { refundGiftToSender } from '../lib/gift-ledger.mjs'
import { deleteIdDocument, readIdDocument, saveIdDocument } from '../lib/id-document-storage.mjs'
import { readDriverDocument } from '../lib/driver-document-storage.mjs'
import { hashPassword, idempotencyKey } from '../lib/security.mjs'
import { assertBoundedString, assertNoUnknownFields, assertValidEmail } from '../lib/validate.mjs'
import { generateUniqueReferralCode } from '../lib/referrals.mjs'
import { createStripeCardRefund, extractStripePaymentIntentId, isStripeConfigured } from './payments.mjs'
import { decryptPayoutAccount } from '../lib/payout-account.mjs'
import { randomUUID } from 'node:crypto'
import { json, methodNotAllowed, readJson } from '../lib/responses.mjs'
import { computeStandingStats, ruleTier, validTiersFor } from '../lib/account-standing.mjs'
import { suggestTier } from '../lib/ai-loyalty.mjs'
import { countActiveLoginLocks } from '../lib/login-lockout.mjs'

// The internal staff roles the HR department manages/creates. Deliberately NOT HOST/DRIVER/SELLER
// (those self-register through the normal flow) — only privileged back-office roles.
const STAFF_ROLES = ['ADMIN', 'SUPPORT']
const STAFF_EMAIL_DOMAIN = '@sybnb.app'

// Compute one user's standing suggestion and queue it (PENDING) — but only when the AI/rule tier would
// actually CHANGE their current tier. Replaces any prior pending suggestion for that user+kind. Shared
// by the batch scan and the single-user suggest endpoints. Returns the created suggestion or null.
async function upsertStandingSuggestion(userId, kind) {
  const stats = await computeStandingStats(userId, kind)
  if (!stats) return null
  const standing = await db().accountStanding.findUnique({ where: { userId_kind: { userId, kind } } })
  const currentTier = standing?.tier || 'NEW'
  const { suggestedTier, reason, model } = await suggestTier(kind, stats)
  if (suggestedTier === currentTier) return null
  await db().standingSuggestion.deleteMany({ where: { userId, kind, status: 'PENDING' } })
  return db().standingSuggestion.create({
    data: { userId, kind, currentTier, suggestedTier, reason, stats, aiModel: model },
  })
}

// Surface only what admin needs to push a payout — type, holder, last4. The encrypted number
// envelope (ciphertext/iv/tag stored in User.payoutMethod) must never reach the admin client.
function safeHostPayoutMethod(payoutMethod) {
  if (!payoutMethod || typeof payoutMethod !== 'object' || payoutMethod.type !== 'sham_cash') {
    return null
  }
  // Strip only the encrypted number envelope; pass through the safe display fields. This works for
  // BOTH the legacy shape ({ phone, receiverName }) and the new encrypted shape
  // ({ accountHolder, last4, ...envelope }) — the ciphertext/iv/tag/alg never reach the client.
  const { ciphertext, iv, tag, alg, ...safe } = payoutMethod
  return safe
}

function payoutNotEligibleError() {
  const error = new Error(
    `Payout is not eligible for release yet. It must be COMPLETED and past the ${PAYOUT_HOLD_DAYS}-day hold, with no open dispute.`,
  )
  error.statusCode = 400
  error.code = 'PAYOUT_NOT_ELIGIBLE'
  error.expose = true
  return error
}

export async function handleAdmin(req, res, url, context) {
  const hideReviewMatch = url.pathname.match(/^\/api\/admin\/reviews\/([^/]+)\/hide$/)
  if (hideReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const existing = await db().listingReview.findUnique({ where: { id: hideReviewMatch[1] } })
    if (!existing) {
      const error = new Error('Review not found.')
      error.statusCode = 404
      error.code = 'REVIEW_NOT_FOUND'
      error.expose = true
      throw error
    }

    const review = await db().listingReview.update({
      where: { id: existing.id },
      data: { hiddenAt: new Date(), hiddenByAdminId: context.user.id },
    })

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_REVIEW_HIDDEN',
        entityType: 'listing_reviews',
        entityId: review.id,
        before: existing,
        after: review,
      },
    })

    return json(res, 200, { ok: true, review })
  }

  if (url.pathname === '/api/admin/host-insights') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const insights = await db().hostInsight.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        host: { select: { id: true, displayName: true, email: true } },
        listing: { select: { id: true, titleAr: true, titleEn: true } },
      },
    })
    const totals = {
      generated: insights.length,
      emailed: insights.filter((insight) => insight.emailSentAt).length,
      read: insights.filter((insight) => insight.readAt).length,
    }
    return json(res, 200, { ok: true, insights, totals })
  }

  // ---- HR DEPARTMENT — staff/admin directory + creation (owner/super-admin gated) ----
  if (url.pathname === '/api/admin/staff') {
    if (req.method === 'GET') {
      // Reading the staff directory is fine for any back-office role.
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const staff = await db().user.findMany({
        where: { roles: { some: { role: { in: STAFF_ROLES } } } },
        select: {
          id: true,
          displayName: true,
          email: true,
          createdAt: true,
          roles: { select: { role: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })
      return json(res, 200, {
        ok: true,
        staff: staff.map((user) => ({
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          createdAt: user.createdAt,
          roles: user.roles.map((entry) => entry.role),
        })),
      })
    }

    if (req.method === 'POST') {
      // SENSITIVE: creating a privileged account. Restricted to ADMIN — the most-privileged guard
      // this platform has (ADMIN cannot self-register, so an ADMIN is the effective owner/super-admin).
      // Deliberately NOT ['ADMIN','SUPPORT'] — SUPPORT must not be able to mint new admins.
      requireAuth(context, ['ADMIN'])
      const body = await readJson(req)
      assertNoUnknownFields(body, ['displayName', 'email', 'role'], 'staff body')

      const displayName = assertBoundedString(body.displayName, {
        fieldName: 'displayName',
        maxLength: 120,
        required: true,
      })
      const email = assertValidEmail(body.email)
      if (!email) {
        const error = new Error('A staff email address is required.')
        error.statusCode = 400
        error.code = 'STAFF_EMAIL_REQUIRED'
        error.expose = true
        throw error
      }
      if (!email.endsWith(STAFF_EMAIL_DOMAIN)) {
        const error = new Error(`Staff email must be on the ${STAFF_EMAIL_DOMAIN} domain.`)
        error.statusCode = 400
        error.code = 'STAFF_EMAIL_DOMAIN_INVALID'
        error.expose = true
        throw error
      }
      const role = String(body.role || '').toUpperCase()
      if (!STAFF_ROLES.includes(role)) {
        const error = new Error(`Staff role must be one of: ${STAFF_ROLES.join(', ')}.`)
        error.statusCode = 400
        error.code = 'STAFF_ROLE_INVALID'
        error.expose = true
        throw error
      }

      // The account is created with a random, unusable password. The staff member activates it via
      // the existing password-reset OTP to their real @sybnb.app mailbox (created separately in
      // Google Workspace — this endpoint never provisions a mailbox).
      const passwordHash = hashPassword(`${randomUUID()}${randomUUID()}`)

      try {
        const created = await db().$transaction(async (tx) => {
          const referralCode = await generateUniqueReferralCode(tx)
          return tx.user.create({
            data: {
              email,
              passwordHash,
              displayName,
              referralCode,
              roles: { create: { role } },
              wallets: { create: { currency: 'SYP' } },
            },
            include: { roles: true },
          })
        })

        await db().adminAuditLog.create({
          data: {
            actorUserId: context.user.id,
            action: 'ADMIN_STAFF_CREATED',
            entityType: 'users',
            entityId: created.id,
            before: null,
            after: { email, role, displayName },
          },
        })

        return json(res, 201, {
          ok: true,
          staff: {
            id: created.id,
            displayName: created.displayName,
            email: created.email,
            createdAt: created.createdAt,
            roles: created.roles.map((entry) => entry.role),
          },
        })
      } catch (error) {
        if (error?.code === 'P2002') {
          const conflict = new Error('An account with this email already exists.')
          conflict.statusCode = 409
          conflict.code = 'ACCOUNT_ALREADY_EXISTS'
          conflict.expose = true
          throw conflict
        }
        throw error
      }
    }

    return methodNotAllowed(res, ['GET', 'POST'])
  }

  if (url.pathname === '/api/admin/payouts') {
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()

    if (req.method === 'GET') {
      const completedBookings = await db().booking.findMany({
        where: { status: 'COMPLETED' },
        include: {
          listing: { include: { owner: { select: { id: true, displayName: true, payoutMethod: true } } } },
          payments: true,
        },
        orderBy: { checkOut: 'asc' },
        take: 100,
      })

      const releasedBookingIds = new Set(
        (
          await db().walletEntry.findMany({
            where: {
              referenceType: 'booking_payout',
              type: 'RELEASE',
              referenceId: { in: completedBookings.map((b) => b.id) },
            },
            select: { referenceId: true },
          })
        ).map((entry) => entry.referenceId),
      )

      const payouts = completedBookings
        .filter((booking) => !releasedBookingIds.has(booking.id))
        .map((booking) => {
          const approvedPayment = booking.payments.find((payment) => payment.status === 'APPROVED')
          const split = bookingFinanceSplit(booking, approvedPayment?.amountMinor || booking.amountMinor)
          return {
            bookingId: booking.id,
            listingTitle: booking.listing?.titleAr,
            hostId: booking.listing?.ownerId,
            hostName: booking.listing?.owner?.displayName,
            hostPayoutMethod: safeHostPayoutMethod(booking.listing?.owner?.payoutMethod),
            checkOut: booking.checkOut,
            eligibleAt: payoutEligibleAt(booking.checkOut),
            eligibleNow: isPayoutEligible(booking),
            payoutHeld: booking.metadata?.payoutHeld === true,
            hostPayoutMinor: split.hostGrossMinor,
            currency: booking.currency,
          }
        })

      return json(res, 200, { ok: true, payouts, holdDays: PAYOUT_HOLD_DAYS })
    }

    return methodNotAllowed(res, ['GET'])
  }

  // ---- Reveal a host's Sham Cash number for an eligible payout (ADMIN-ONLY) ----
  // The operator needs the real number to actually push the transfer. It is returned ONLY in this
  // response body over the authenticated ADMIN channel — never written to any log/audit (only the
  // last4 is audited). Handles both the encrypted shape and the legacy plaintext-phone shape.
  const payoutAccountMatch = url.pathname.match(/^\/api\/admin\/payouts\/([^/]+)\/account$/)
  if (payoutAccountMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN'])
    const booking = await db().booking.findUnique({
      where: { id: payoutAccountMatch[1] },
      include: { listing: { include: { owner: { select: { id: true, displayName: true, payoutMethod: true } } } } },
    })
    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    const pm = booking.listing?.owner?.payoutMethod
    if (!pm || typeof pm !== 'object') {
      const error = new Error('This host has no payout method on file.')
      error.statusCode = 400
      error.code = 'PAYOUT_METHOD_REQUIRED'
      error.expose = true
      throw error
    }

    let account = null
    let last4 = ''
    if (pm.type === 'sham_cash' && pm.ciphertext) {
      const number = decryptPayoutAccount(pm)
      if (!number) {
        const error = new Error('Could not decrypt the payout account.')
        error.statusCode = 500
        error.code = 'PAYOUT_ACCOUNT_DECRYPT_FAILED'
        error.expose = true
        throw error
      }
      last4 = pm.last4 || number.slice(-4)
      account = { type: 'sham_cash', accountHolder: pm.accountHolder || '', number }
    } else if (pm.phone) {
      // Legacy shape { phone, receiverName } — the phone is already plaintext, return as-is.
      last4 = String(pm.phone).replace(/\D/g, '').slice(-4)
      account = { type: 'legacy', accountHolder: pm.receiverName || '', number: String(pm.phone) }
    } else {
      const error = new Error('This host payout method has no revealable account number.')
      error.statusCode = 400
      error.code = 'PAYOUT_ACCOUNT_UNSUPPORTED'
      error.expose = true
      throw error
    }

    // Audit the reveal WITHOUT the number itself — only who revealed which host's account, and last4.
    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_PAYOUT_ACCOUNT_REVEALED',
        entityType: 'users',
        entityId: booking.listing.owner.id,
        before: null,
        after: { bookingId: booking.id, last4 },
      },
    })

    return json(res, 200, { ok: true, account })
  }

  const payoutReleaseMatch = url.pathname.match(/^\/api\/admin\/payouts\/([^/]+)\/release$/)
  if (payoutReleaseMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])

    // A real disbursement must reconcile against the actual Sham Cash transfer — mirror the SR-driver
    // release: require the external transaction reference so the ledger is auditable.
    const body = await readJson(req).catch(() => ({}))
    const payoutRef = String(body.payoutRef || body.shamCashRef || '').trim()
    if (!payoutRef) {
      const error = new Error('A payoutRef (the Sham Cash transaction reference) is required so the payout reconciles against the real transfer.')
      error.statusCode = 400
      error.code = 'PAYOUT_REF_REQUIRED'
      error.expose = true
      throw error
    }

    const booking = await db().booking.findUnique({
      where: { id: payoutReleaseMatch[1] },
      include: { listing: { include: { owner: { select: { id: true, displayName: true, payoutMethod: true } } } }, payments: true },
    })

    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }

    // Refuse to "pay" a host who has no account on file — exactly like the SR-driver path.
    if (!booking.listing?.owner?.payoutMethod) {
      const error = new Error('This host has no payout method on file. Ask the host to add a Sham Cash payout account before releasing a payout.')
      error.statusCode = 400
      error.code = 'PAYOUT_METHOD_REQUIRED'
      error.expose = true
      throw error
    }

    const entry = await db().$transaction(async (tx) => {
      // TOCTOU-safe: claim the row on the exact status we require, then re-load and re-check payout
      // eligibility INSIDE the transaction — so a concurrent state change (dispute, re-open) between the
      // outer read and here can never let a payout be released against a no-longer-eligible booking.
      const guarded = await tx.booking.updateMany({
        where: { id: booking.id, status: 'COMPLETED' },
        data: { updatedAt: new Date() },
      })
      if (guarded.count !== 1) throw payoutNotEligibleError()

      const freshBooking = await tx.booking.findUnique({
        where: { id: booking.id },
        include: { listing: { include: { owner: { select: { id: true, payoutMethod: true } } } }, payments: true },
      })
      if (!freshBooking || !isPayoutEligible(freshBooking)) throw payoutNotEligibleError()
      // Manual admin hold — an admin can pause this payout even once it's time-eligible. Enforced here so
      // the hold actually stops the money, not just a UI note. Cleared via POST .../payout-hold {held:false}.
      if (freshBooking.metadata?.payoutHeld === true) {
        const error = new Error('This payout is on manual hold. Remove the hold before releasing it.')
        error.statusCode = 409
        error.code = 'PAYOUT_ON_MANUAL_HOLD'
        error.expose = true
        throw error
      }
      // Re-check the payout method inside the transaction too, in case it was removed concurrently.
      if (!freshBooking.listing?.owner?.payoutMethod) {
        const error = new Error('This host has no payout method on file.')
        error.statusCode = 400
        error.code = 'PAYOUT_METHOD_REQUIRED'
        error.expose = true
        throw error
      }

      const approvedPayment = freshBooking.payments.find((payment) => payment.status === 'APPROVED')
      const split = bookingFinanceSplit(freshBooking, approvedPayment?.amountMinor || freshBooking.amountMinor)
      const released = await recordWalletEntry(tx, {
        userId: freshBooking.listing.ownerId,
        type: 'RELEASE',
        amountMinor: split.hostGrossMinor,
        currency: freshBooking.currency,
        referenceType: 'booking_payout',
        referenceId: freshBooking.id,
        // One payout per booking — the key intentionally excludes payoutRef so a second release with a
        // different ref cannot double-pay the host (recordWalletEntry dedupes on this key).
        keyParts: ['booking-host-release', freshBooking.id, approvedPayment?.id],
        note: `Host payout released by admin after the ${PAYOUT_HOLD_DAYS}-day hold following stay completion; Sham Cash ref ${payoutRef}.`,
      })

      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_PAYOUT_RELEASED',
          entityType: 'bookings',
          entityId: freshBooking.id,
          before: freshBooking,
          after: { walletEntry: released, payoutRef },
        },
      })

      return released
    })

    return json(res, 200, { ok: true, walletEntry: entry })
  }

  if (url.pathname === '/api/admin/review-queue') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    await completeExpiredBookings()
    const [listings, payments, gifts, bookings, idDocuments] = await Promise.all([
      db().listing.findMany({ where: { status: 'PENDING_REVIEW' }, take: 25 }),
      db().paymentProof.findMany({
        where: { status: 'PENDING_ADMIN_REVIEW' },
        include: {
          booking: {
            include: {
              listing: {
                include: {
                  owner: { select: { id: true, displayName: true, email: true, idDocumentStatus: true } },
                },
              },
            },
          },
          payer: { select: { id: true, displayName: true, email: true } },
        },
        take: 25,
      }),
      db().walletGift.findMany({ where: { status: { in: ['CLAIM_PENDING', 'LOCKED'] } }, take: 25 }),
      db().booking.findMany({
        where: { status: { in: ['REQUESTED', 'DISPUTED'] } },
        include: { listing: true },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
      db().user.findMany({
        where: { idDocumentStatus: 'PENDING_REVIEW' },
        select: { id: true, displayName: true, email: true, idDocumentMimeType: true, idDocumentSubmittedAt: true },
        take: 25,
      }),
    ])
    return json(res, 200, { ok: true, queue: { listings, payments, gifts, bookings, idDocuments } })
  }

  const idDocumentFileMatch = url.pathname.match(/^\/api\/admin\/id-document\/([^/]+)\/file$/)
  if (idDocumentFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const targetUser = await db().user.findUnique({
      where: { id: idDocumentFileMatch[1] },
      select: { idDocumentRef: true, idDocumentMimeType: true },
    })
    if (!targetUser?.idDocumentRef) {
      const error = new Error('No ID document has been submitted by this user.')
      error.statusCode = 404
      error.code = 'ID_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }

    const buffer = await readIdDocument(targetUser.idDocumentRef)
    res.writeHead(200, {
      'content-type': targetUser.idDocumentMimeType || 'application/octet-stream',
      'cache-control': 'private, no-store',
    })
    res.end(buffer)
    return true
  }

  // Supports the WhatsApp/email ID-submission channel: a guest who doesn't want to upload
  // through the website sends their ID to SYBNB's WhatsApp/email directly, and an admin attaches
  // it to the right account here after finding it by the email the guest signed up with.
  if (url.pathname === '/api/admin/users/lookup') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const email = String(url.searchParams.get('email') || '').trim().toLowerCase()
    if (!email) {
      const error = new Error('An email is required to look up a customer.')
      error.statusCode = 400
      error.code = 'USER_LOOKUP_EMAIL_REQUIRED'
      error.expose = true
      throw error
    }

    const foundUser = await db().user.findUnique({
      where: { email },
      select: ID_DOCUMENT_SAFE_SELECT,
    })
    if (!foundUser) {
      const error = new Error('No account found with this email.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    return json(res, 200, { ok: true, user: foundUser })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACCOUNT CONTROL — universal admin control over ANY account, across every
  // section of the control center. Generalizes the driver kill-switch (below)
  // to all roles: open an account, fix it, or suspend / reinstate / soft-delete
  // it. Suspend & delete bump sessionVersion so the target is logged out on
  // their next request (auth-context.mjs already rejects non-ACTIVE + stale sv).
  // ─────────────────────────────────────────────────────────────────────────

  // Which roles each control-center section manages. 'management'/'all' => everyone.
  const ACCOUNT_SECTION_ROLES = {
    guest: ['GUEST'],
    host: ['HOST'],
    accounting: ['SELLER'],
    hr: ['ADMIN', 'SUPPORT'],
    staff: ['ADMIN', 'SUPPORT'],
    driver: ['DRIVER'],
  }

  // Search / list accounts by section (role) + status + free text.
  if (url.pathname === '/api/admin/accounts') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const section = String(url.searchParams.get('section') || 'all').toLowerCase()
    const statusFilter = String(url.searchParams.get('status') || '').toUpperCase()
    const q = String(url.searchParams.get('q') || '').trim()
    const roleFilter = ACCOUNT_SECTION_ROLES[section] // undefined => all sections (management)

    const accounts = await db().user.findMany({
      where: {
        ...(roleFilter ? { roles: { some: { role: { in: roleFilter } } } } : {}),
        ...(['ACTIVE', 'SUSPENDED', 'DELETED'].includes(statusFilter) ? { status: statusFilter } : {}),
        ...(q
          ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] }
          : {}),
      },
      select: {
        id: true, displayName: true, email: true, status: true, createdAt: true,
        idDocumentStatus: true, isDemo: true, roles: { select: { role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return json(res, 200, { ok: true, accounts: accounts.map((a) => ({ ...a, roles: a.roles.map((r) => r.role) })) })
  }

  // Suspend (revoke) / reinstate (release) / soft-delete an account — the universal kill switch.
  const accountStatusMatch = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)\/status$/)
  if (accountStatusMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN']) // status changes are ADMIN-only, not SUPPORT
    const targetId = accountStatusMatch[1]
    const body = await readJson(req)
    const nextStatus = String(body.status || '').toUpperCase()
    if (!['ACTIVE', 'SUSPENDED', 'DELETED'].includes(nextStatus)) {
      const error = new Error('status must be ACTIVE, SUSPENDED, or DELETED.')
      error.statusCode = 400
      error.code = 'ACCOUNT_STATUS_INVALID'
      error.expose = true
      throw error
    }
    // A revoke/delete must carry a reason — it goes into the audit trail.
    if (nextStatus !== 'ACTIVE' && !body.reason) {
      const error = new Error('A reason is required to suspend or delete an account.')
      error.statusCode = 400
      error.code = 'ACCOUNT_REASON_REQUIRED'
      error.expose = true
      throw error
    }
    const reason = body.reason ? assertBoundedString(body.reason, { fieldName: 'reason', maxLength: 500 }) : null

    // Guard: an admin can never lock/delete their own account.
    if (targetId === context.user.id) {
      const error = new Error('You cannot change the status of your own account.')
      error.statusCode = 400
      error.code = 'ACCOUNT_SELF_ACTION_FORBIDDEN'
      error.expose = true
      throw error
    }

    const target = await db().user.findUnique({ where: { id: targetId }, include: { roles: true } })
    if (!target) {
      const error = new Error('Account not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    // Guard: never suspend/delete the LAST active admin — that would lock everyone out of the console.
    if (nextStatus !== 'ACTIVE' && target.roles.some((r) => r.role === 'ADMIN')) {
      const otherActiveAdmins = await db().user.count({
        where: { id: { not: targetId }, status: 'ACTIVE', roles: { some: { role: 'ADMIN' } } },
      })
      if (otherActiveAdmins === 0) {
        const error = new Error('This is the last active admin — reinstate another admin before changing this one.')
        error.statusCode = 409
        error.code = 'LAST_ADMIN_PROTECTED'
        error.expose = true
        throw error
      }
    }

    const updated = await db().$transaction(async (tx) => {
      const bumpSession = nextStatus !== 'ACTIVE'
      const u = await tx.user.update({
        where: { id: targetId },
        data: {
          status: nextStatus,
          // Suspend/delete invalidate live tokens immediately; reinstate clears the soft-delete tombstone.
          ...(bumpSession ? { sessionVersion: { increment: 1 } } : {}),
          ...(nextStatus === 'DELETED' ? { deletedAt: new Date() } : {}),
          ...(nextStatus === 'ACTIVE' ? { deletedAt: null } : {}),
        },
        select: { id: true, status: true, deletedAt: true },
      })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `ACCOUNT_STATUS_${nextStatus}`,
          entityType: 'users',
          entityId: targetId,
          before: { status: target.status },
          after: { status: nextStatus, reason },
        },
      })
      return u
    })
    return json(res, 200, { ok: true, account: updated })
  }

  // Open one account (full record) OR fix its safe fields / roles.
  const accountRecordMatch = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/)
  if (accountRecordMatch) {
    const targetId = accountRecordMatch[1]

    if (req.method === 'GET') {
      requireAuth(context, ['ADMIN', 'SUPPORT'])
      const account = await db().user.findUnique({
        where: { id: targetId },
        select: {
          id: true, displayName: true, email: true, locale: true, status: true,
          idDocumentStatus: true, idDocumentRef: true, isDemo: true,
          createdAt: true, deletedAt: true, roles: { select: { role: true } },
        },
      })
      if (!account) {
        const error = new Error('Account not found.')
        error.statusCode = 404
        error.code = 'USER_NOT_FOUND'
        error.expose = true
        throw error
      }
      const [listingsCount, bookingsCount, paymentProofsCount, recentActivity] = await Promise.all([
        db().listing.count({ where: { ownerId: targetId } }),
        db().booking.count({ where: { guestId: targetId } }),
        db().paymentProof.count({ where: { userId: targetId } }),
        db().adminAuditLog.findMany({
          where: { entityType: 'users', entityId: targetId },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { action: true, createdAt: true, after: true },
        }),
      ])
      return json(res, 200, {
        ok: true,
        account: {
          ...account,
          roles: account.roles.map((r) => r.role),
          hasIdDocument: Boolean(account.idDocumentRef),
          idDocumentRef: undefined,
          counts: { listings: listingsCount, bookings: bookingsCount, paymentProofs: paymentProofsCount },
          recentActivity,
        },
      })
    }

    if (req.method === 'PATCH') {
      requireAuth(context, ['ADMIN']) // editing an account (incl. roles) is ADMIN-only
      const body = await readJson(req)
      assertNoUnknownFields(body, ['displayName', 'locale', 'email', 'addRoles', 'removeRoles'], 'account edit body')

      const target = await db().user.findUnique({ where: { id: targetId }, include: { roles: true } })
      if (!target) {
        const error = new Error('Account not found.')
        error.statusCode = 404
        error.code = 'USER_NOT_FOUND'
        error.expose = true
        throw error
      }

      const data = {}
      if (body.displayName !== undefined) data.displayName = assertBoundedString(body.displayName, { fieldName: 'displayName', maxLength: 120 })
      if (body.locale !== undefined) data.locale = assertBoundedString(body.locale, { fieldName: 'locale', maxLength: 12 })
      if (body.email !== undefined) data.email = assertValidEmail(body.email).toLowerCase()

      const VALID_ROLES = ['GUEST', 'HOST', 'SELLER', 'DRIVER', 'ADMIN', 'SUPPORT']
      const addRoles = Array.isArray(body.addRoles) ? body.addRoles.map((r) => String(r).toUpperCase()).filter((r) => VALID_ROLES.includes(r)) : []
      const removeRoles = Array.isArray(body.removeRoles) ? body.removeRoles.map((r) => String(r).toUpperCase()).filter((r) => VALID_ROLES.includes(r)) : []

      // Guard: don't strip ADMIN from the last active admin.
      if (removeRoles.includes('ADMIN') && target.roles.some((r) => r.role === 'ADMIN')) {
        const otherActiveAdmins = await db().user.count({
          where: { id: { not: targetId }, status: 'ACTIVE', roles: { some: { role: 'ADMIN' } } },
        })
        if (otherActiveAdmins === 0) {
          const error = new Error('Cannot remove ADMIN from the last active admin.')
          error.statusCode = 409
          error.code = 'LAST_ADMIN_PROTECTED'
          error.expose = true
          throw error
        }
      }

      const updated = await db().$transaction(async (tx) => {
        if (Object.keys(data).length) await tx.user.update({ where: { id: targetId }, data })
        for (const role of removeRoles) await tx.userRole.deleteMany({ where: { userId: targetId, role } })
        for (const role of addRoles) {
          const exists = await tx.userRole.findFirst({ where: { userId: targetId, role } })
          if (!exists) await tx.userRole.create({ data: { userId: targetId, role } })
        }
        await tx.adminAuditLog.create({
          data: {
            actorUserId: context.user.id,
            action: 'ACCOUNT_EDIT',
            entityType: 'users',
            entityId: targetId,
            before: { displayName: target.displayName, email: target.email, locale: target.locale, roles: target.roles.map((r) => r.role) },
            after: { ...data, addRoles, removeRoles },
          },
        })
        return tx.user.findUnique({
          where: { id: targetId },
          select: { id: true, displayName: true, email: true, locale: true, status: true, roles: { select: { role: true } } },
        })
      })
      return json(res, 200, { ok: true, account: { ...updated, roles: updated.roles.map((r) => r.role) } })
    }

    return methodNotAllowed(res, ['GET', 'PATCH'])
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOYALTY / STANDING (Phase 2) — AI SUGGESTS a tier, an ADMIN APPROVES it.
  // A user's live tier NEVER changes without an approved suggestion.
  // ─────────────────────────────────────────────────────────────────────────

  // On-demand scan: propose tiers for a batch of active users of a kind (HOST|GUEST).
  if (url.pathname === '/api/admin/standing/scan') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const kind = String(body.kind || '').toUpperCase()
    if (kind !== 'HOST' && kind !== 'GUEST') {
      const error = new Error('kind must be HOST or GUEST.')
      error.statusCode = 400
      error.code = 'STANDING_KIND_INVALID'
      error.expose = true
      throw error
    }
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 25))
    const users = await db().user.findMany({
      where: { status: 'ACTIVE', roles: { some: { role: kind } } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    let created = 0
    for (const u of users) {
      if (await upsertStandingSuggestion(u.id, kind)) created += 1
    }
    return json(res, 200, { ok: true, scanned: users.length, suggestionsCreated: created })
  }

  // Single-user suggestion (e.g. triggered from the account panel).
  if (url.pathname === '/api/admin/standing/suggest') {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const kind = String(body.kind || '').toUpperCase()
    const userId = String(body.userId || '')
    if ((kind !== 'HOST' && kind !== 'GUEST') || !userId) {
      const error = new Error('userId and a valid kind (HOST|GUEST) are required.')
      error.statusCode = 400
      error.code = 'STANDING_INPUT_INVALID'
      error.expose = true
      throw error
    }
    const suggestion = await upsertStandingSuggestion(userId, kind)
    return json(res, 200, { ok: true, suggestion })
  }

  // The pending approval queue.
  if (url.pathname === '/api/admin/standing/suggestions') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const status = String(url.searchParams.get('status') || 'PENDING').toUpperCase()
    const suggestions = await db().standingSuggestion.findMany({
      where: { status: ['PENDING', 'APPROVED', 'REJECTED'].includes(status) ? status : 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, displayName: true, email: true } } },
    })
    return json(res, 200, { ok: true, suggestions })
  }

  // Approve (applies the tier) or reject a suggestion.
  const standingDecideMatch = url.pathname.match(/^\/api\/admin\/standing\/suggestions\/([^/]+)$/)
  if (standingDecideMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const id = standingDecideMatch[1]
    const body = await readJson(req)
    const decision = String(body.decision || '').toUpperCase()
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      const error = new Error('decision must be APPROVE or REJECT.')
      error.statusCode = 400
      error.code = 'STANDING_DECISION_INVALID'
      error.expose = true
      throw error
    }
    const suggestion = await db().standingSuggestion.findUnique({ where: { id } })
    if (!suggestion) {
      const error = new Error('Suggestion not found.')
      error.statusCode = 404
      error.code = 'STANDING_SUGGESTION_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (suggestion.status !== 'PENDING') {
      const error = new Error('This suggestion has already been decided.')
      error.statusCode = 409
      error.code = 'STANDING_ALREADY_DECIDED'
      error.expose = true
      throw error
    }

    const result = await db().$transaction(async (tx) => {
      const decided = await tx.standingSuggestion.update({
        where: { id },
        data: { status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedById: context.user.id, decidedAt: new Date() },
      })
      if (decision === 'APPROVE') {
        // Only an approved suggestion ever writes a user's live tier.
        await tx.accountStanding.upsert({
          where: { userId_kind: { userId: suggestion.userId, kind: suggestion.kind } },
          create: { userId: suggestion.userId, kind: suggestion.kind, tier: suggestion.suggestedTier, grantedById: context.user.id },
          update: { tier: suggestion.suggestedTier, grantedById: context.user.id, grantedAt: new Date() },
        })
      }
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `STANDING_${decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'}`,
          entityType: 'standing_suggestions',
          entityId: id,
          before: { status: 'PENDING', tier: suggestion.currentTier },
          after: { status: decided.status, kind: suggestion.kind, tier: suggestion.suggestedTier },
        },
      })
      return decided
    })
    return json(res, 200, { ok: true, suggestion: result })
  }

  const idDocumentAdminUploadMatch = url.pathname.match(/^\/api\/admin\/id-document\/([^/]+)\/upload$/)
  if (idDocumentAdminUploadMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const body = await readJson(req)
    const fileBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64 : ''
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (!fileBase64 || !mimeType) {
      const error = new Error('An ID document file is required.')
      error.statusCode = 400
      error.code = 'ID_DOCUMENT_REQUIRED'
      error.expose = true
      throw error
    }

    const targetUserId = idDocumentAdminUploadMatch[1]
    const previous = await db().user.findUnique({ where: { id: targetUserId }, select: { idDocumentRef: true } })
    if (!previous) {
      const error = new Error('Customer not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }

    const storageKey = await saveIdDocument(fileBase64, mimeType)
    const updated = await db().user.update({
      where: { id: targetUserId },
      data: {
        idDocumentRef: storageKey,
        idDocumentMimeType: mimeType,
        idDocumentSubmittedAt: new Date(),
        idDocumentStatus: 'PENDING_REVIEW',
        idDocumentReviewedById: null,
        idDocumentReviewedAt: null,
      },
      select: ID_DOCUMENT_SAFE_SELECT,
    })

    if (previous.idDocumentRef && previous.idDocumentRef !== storageKey) {
      await deleteIdDocument(previous.idDocumentRef)
    }

    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ID_DOCUMENT_UPLOADED_BY_ADMIN',
        entityType: 'iddocuments',
        entityId: targetUserId,
        before: {},
        after: updated,
      },
    })

    return json(res, 200, { ok: true, user: updated })
  }

  if (url.pathname === '/api/admin/audit-log') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100)
    const auditLog = await db().adminAuditLog.findMany({
      include: {
        actor: {
          select: {
            id: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return json(res, 200, { ok: true, auditLog })
  }

  // Office-tablet dashboard: one curated, presentation-ready snapshot the admin can watch live OR
  // download as a self-contained offline HTML file to keep on a tablet in the office. Four panels:
  // security (login lockouts + recent security events), bookings/occupancy, revenue/payouts, and the
  // pending-work queue. All bounded aggregate queries — safe to poll on an auto-refresh interval.
  if (url.pathname === '/api/admin/office-dashboard') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const now = new Date()
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const endOfToday = new Date(startOfToday)
    endOfToday.setDate(endOfToday.getDate() + 1)
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const payoutHoldCutoff = new Date(now.getTime() - PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000)

    const [
      bookingsByStatus,
      totalBookings,
      checkInsToday,
      upcoming7d,
      cancellations7d,
      approvedAgg,
      refundedAgg,
      listingsAwaitingReview,
      openDisputes,
      payoutsReady,
      idChecksPending,
      activeLocks,
      lockouts24h,
      recentSecurityEvents,
    ] = await Promise.all([
      db().booking.groupBy({ by: ['status'], _count: { _all: true } }),
      db().booking.count(),
      db().booking.count({ where: { checkIn: { gte: startOfToday, lt: endOfToday }, status: { in: ['CONFIRMED', 'COMPLETED'] } } }),
      db().booking.count({ where: { checkIn: { gte: now, lt: in7d }, status: { in: ['REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED'] } } }),
      db().booking.count({ where: { status: 'CANCELLED', updatedAt: { gte: ago7d } } }),
      db().paymentProof.aggregate({ _sum: { amountMinor: true }, _count: { _all: true }, where: { status: 'APPROVED' } }),
      db().paymentProof.aggregate({ _sum: { amountMinor: true }, _count: { _all: true }, where: { status: 'REFUNDED', reviewedAt: { gte: ago7d } } }),
      db().listing.count({ where: { status: 'PENDING_REVIEW' } }),
      db().dispute.count({ where: { status: 'OPEN' } }),
      db().booking.count({ where: { status: 'COMPLETED', checkOut: { lt: payoutHoldCutoff } } }),
      db().user.count({ where: { idDocumentStatus: 'PENDING_REVIEW' } }),
      countActiveLoginLocks(),
      db().adminAuditLog.count({ where: { action: 'SECURITY_LOGIN_LOCKOUT', createdAt: { gte: ago24h } } }),
      db().adminAuditLog.findMany({
        where: {
          OR: [
            { entityType: 'security' },
            { action: { in: ['BOOKING_CARD_REFUNDED', 'DISPUTE_REFUNDED', 'ADMIN_FORCE_CANCEL', 'ACCOUNT_STATUS_CHANGED', 'BOOKING_GUEST_CANCELLED'] } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          action: true,
          entityType: true,
          createdAt: true,
          after: true,
          actor: { select: { displayName: true, email: true } },
        },
      }),
    ])

    const byStatus = Object.fromEntries(bookingsByStatus.map((row) => [row.status, row._count._all]))

    return json(res, 200, {
      ok: true,
      generatedAt: now.toISOString(),
      security: {
        activeLocks,
        lockouts24h,
        // Security events never carry the raw identifier (entityId is a hash), so this is safe to render
        // and to bake into a downloaded snapshot.
        recentEvents: recentSecurityEvents,
      },
      bookings: {
        total: totalBookings,
        byStatus,
        checkInsToday,
        upcoming7d,
        cancellations7d,
      },
      revenue: {
        currency: 'USD',
        grossApprovedMinor: approvedAgg._sum.amountMinor || 0,
        approvedCount: approvedAgg._count._all || 0,
        refunded7dMinor: refundedAgg._sum.amountMinor || 0,
        refunded7dCount: refundedAgg._count._all || 0,
      },
      pending: {
        listingsAwaitingReview,
        openDisputes,
        payoutsReady,
        idChecksPending,
      },
    })
  }

  // SR live-ops dispatch board: every in-flight ride + every online driver, with coordinates, for the
  // admin dispatch map. Coordinates come straight from PostGIS geometry via ST_X/ST_Y (no spatial_ref_sys
  // dependency). ADMIN/SUPPORT only. Rider/driver emails are never selected — only display names.
  if (url.pathname === '/api/admin/sr/dispatch') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const [activeRides, onlineDrivers] = await Promise.all([
      db().$queryRaw`
        SELECT r.id, r.status, r.requested_at AS "requestedAt",
               ST_Y(r.pickup_geo) AS "pickupLat", ST_X(r.pickup_geo) AS "pickupLng",
               ru.display_name AS "riderName", du.display_name AS "driverName"
        FROM ride_requests r
        JOIN users ru ON ru.id = r.rider_id
        LEFT JOIN users du ON du.id = r.driver_id
        WHERE r.status IN ('REQUESTED','MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','IN_PROGRESS')
          AND r.pickup_geo IS NOT NULL
        ORDER BY r.requested_at DESC
        LIMIT 100
      `,
      db().$queryRaw`
        SELECT dp.user_id AS "driverId", u.display_name AS "driverName",
               ST_Y(dp.last_location_geo) AS lat, ST_X(dp.last_location_geo) AS lng,
               dp.last_location_at AS "lastLocationAt",
               EXISTS(
                 SELECT 1 FROM ride_requests r
                 WHERE r.driver_id = dp.user_id AND r.status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','IN_PROGRESS')
               ) AS busy
        FROM driver_profiles dp
        JOIN users u ON u.id = dp.user_id
        WHERE dp.active = true AND dp.last_location_geo IS NOT NULL
          AND dp.last_location_at > now() - interval '15 minutes'
        ORDER BY dp.last_location_at DESC
        LIMIT 200
      `,
    ])

    const rides = activeRides.map((r) => ({
      id: r.id,
      status: r.status,
      requestedAt: r.requestedAt,
      pickup: { lat: Number(r.pickupLat), lng: Number(r.pickupLng) },
      riderName: r.riderName,
      driverName: r.driverName,
    }))
    const drivers = onlineDrivers.map((d) => ({
      driverId: d.driverId,
      driverName: d.driverName,
      location: { lat: Number(d.lat), lng: Number(d.lng) },
      lastLocationAt: d.lastLocationAt,
      busy: Boolean(d.busy),
    }))

    return json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      counts: {
        activeRides: rides.length,
        waitingRides: rides.filter((r) => ['REQUESTED', 'MATCHING'].includes(r.status)).length,
        onlineDrivers: drivers.length,
        busyDrivers: drivers.filter((d) => d.busy).length,
      },
      rides,
      drivers,
    })
  }

  // SR admin force-cancel — recover a STUCK ride (unresponsive driver mid-trip, ghosted match) that
  // neither rider nor driver can clear. Flips any in-flight ride to CANCELLED, which drops it out of the
  // held-status set so the rider's state-derived fund reservation releases automatically (no completion,
  // so nothing was ever charged). ADMIN only, audited.
  const srRideCancelMatch = url.pathname.match(/^\/api\/admin\/sr\/rides\/([^/]+)\/cancel$/)
  if (srRideCancelMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const rideId = srRideCancelMatch[1]
    const body = await readJson(req).catch(() => ({}))
    const reason = String(body.reason || 'Admin force-cancelled a stuck ride').slice(0, 500)
    const updated = await db().rideRequest.updateMany({
      where: { id: rideId, status: { in: ['REQUESTED', 'MATCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'IN_PROGRESS'] } },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledByRole: 'ADMIN', cancelReason: reason, offeredDriverId: null, offerExpiresAt: null },
    })
    if (updated.count === 0) {
      const error = new Error('This ride is not found or is already in a terminal state.')
      error.statusCode = 409
      error.code = 'SR_RIDE_NOT_CANCELLABLE'
      error.expose = true
      throw error
    }
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'ADMIN_SR_RIDE_CANCELLED', entityType: 'ride_requests', entityId: rideId, after: { reason } },
    })
    const ride = await db().rideRequest.findUnique({ where: { id: rideId } })
    return json(res, 200, { ok: true, ride })
  }

  if (url.pathname === '/api/admin/platform-metrics') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const [
      usersByRole,
      listingsByDivision,
      listingsByStatus,
      bookingsByStatus,
      ridesByStatus,
      paymentsByStatus,
      giftsByStatus,
      wallets,
      approvedPaymentVolume,
    ] = await Promise.all([
      db().userRole.groupBy({ by: ['role'], _count: { _all: true } }),
      db().listing.groupBy({ by: ['division'], _count: { _all: true }, orderBy: { division: 'asc' } }),
      db().listing.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().booking.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().rideRequest.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().paymentProof.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().walletGift.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
      db().wallet.aggregate({ _count: { _all: true }, _sum: { cachedBalanceMinor: true } }),
      db().paymentProof.aggregate({
        where: { status: 'APPROVED' },
        _count: { _all: true },
        _sum: { amountMinor: true },
      }),
    ])

    return json(res, 200, {
      ok: true,
      metrics: {
        usersByRole: toCountMap(usersByRole, 'role'),
        listingsByDivision: toCountMap(listingsByDivision, 'division'),
        listingsByStatus: toCountMap(listingsByStatus, 'status'),
        bookingsByStatus: toCountMap(bookingsByStatus, 'status'),
        ridesByStatus: toCountMap(ridesByStatus, 'status'),
        paymentsByStatus: toCountMap(paymentsByStatus, 'status'),
        giftsByStatus: toCountMap(giftsByStatus, 'status'),
        walletCount: wallets._count._all,
        walletBalanceMinor: wallets._sum.cachedBalanceMinor || 0,
        approvedPaymentCount: approvedPaymentVolume._count._all,
        approvedPaymentVolumeMinor: approvedPaymentVolume._sum.amountMinor || 0,
      },
    })
  }

  if (url.pathname === '/api/admin/revenue-summary') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    // Platform revenue = the real admin-credited wallet-entry kinds: the STR admin commission share,
    // the (non-refundable) cancellation-protection fee, the seller/dealer/developer plan fee, the STR
    // host-plan fee, AND the SR ride commission (15% of each completed ride's fare, credited to the admin
    // wallet by chargeCompletedRide() as sr_admin_commission). All are CREDIT entries.
    const [commissionEntries, completedSrRides] = await Promise.all([
      db().walletEntry.findMany({
        where: { type: 'CREDIT', referenceType: { in: ['booking_admin_share', 'booking_protection_fee', 'seller_plan_fee', 'str_host_plan_fee', 'sr_admin_commission'] } },
        select: { amountMinor: true, currency: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      db().rideRequest.aggregate({
        where: { status: 'COMPLETED' },
        _count: { _all: true },
        _sum: { fareMinor: true },
      }),
    ])

    // Seller-plan fees default to USD while booking commission is SYP (see payments.mjs /
    // bookingFinanceSplit) — summing different currencies' minor units together as one number
    // would silently misreport the total, so each currency gets its own totals/history/projection
    // instead of being flattened into a single (wrongly-labeled) figure.
    const entriesByCurrency = new Map()
    for (const entry of commissionEntries) {
      if (!entriesByCurrency.has(entry.currency)) entriesByCurrency.set(entry.currency, [])
      entriesByCurrency.get(entry.currency).push(entry)
    }

    const byCurrency = Array.from(entriesByCurrency.entries())
      .map(([currency, entries]) => {
        const totalRevenueMinor = entries.reduce((sum, entry) => sum + entry.amountMinor, 0)

        const dailyTotals = new Map()
        for (const entry of entries) {
          const day = entry.createdAt.toISOString().slice(0, 10)
          dailyTotals.set(day, (dailyTotals.get(day) || 0) + entry.amountMinor)
        }
        const history = Array.from(dailyTotals.entries())
          .map(([day, amountMinor]) => ({ day, amountMinor }))
          .sort((a, b) => a.day.localeCompare(b.day))

        const firstDay = new Date(entries[0].createdAt)
        const lastDay = new Date(entries[entries.length - 1].createdAt)
        // +1 so a single day of data still divides by 1, not 0.
        const elapsedDays = Math.max(1, Math.ceil((lastDay.getTime() - firstDay.getTime()) / 86400000) + 1)
        const dailyAverageMinor = totalRevenueMinor / elapsedDays

        return {
          currency,
          totalRevenueMinor,
          sampleSize: entries.length,
          history,
          projection: {
            elapsedDays,
            dailyAverageMinor: Math.round(dailyAverageMinor),
            next30DaysMinor: Math.round(dailyAverageMinor * 30),
            next90DaysMinor: Math.round(dailyAverageMinor * 90),
          },
        }
      })
      .sort((a, b) => b.sampleSize - a.sampleSize)

    return json(res, 200, {
      ok: true,
      revenue: {
        byCurrency,
        srRidesCompletedCount: completedSrRides._count._all,
        srRidesFareVolumeMinor: completedSrRides._sum.fareMinor || 0,
      },
    })
  }

  const approveAllMatch = url.pathname.match(/^\/api\/admin\/accommodations\/([^/]+)\/approve-all$/)
  if (approveAllMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const accommodationId = approveAllMatch[1]

    const result = await db().$transaction(async (tx) => {
      const accommodation = await tx.accommodation.findUnique({ where: { id: accommodationId } })
      if (!accommodation) {
        const error = new Error('Accommodation not found.')
        error.statusCode = 404
        error.code = 'ACCOMMODATION_NOT_FOUND'
        error.expose = true
        throw error
      }

      const pendingListings = await tx.listing.findMany({
        where: { accommodationId, status: 'PENDING_REVIEW' },
        select: { id: true },
      })
      // Same TOCTOU-safe re-check-in-WHERE pattern as the single-listing review-queue approval
      // below — each room type is updated individually so a concurrent decision on one room type
      // can't silently double-apply.
      for (const pending of pendingListings) {
        await tx.listing.updateMany({ where: { id: pending.id, status: 'PENDING_REVIEW' }, data: { status: 'APPROVED' } })
      }

      const accommodationUpdate =
        accommodation.status === 'PENDING_REVIEW' ? { status: 'APPROVED' } : {}
      const updatedAccommodation = await tx.accommodation.update({
        where: { id: accommodationId },
        data: accommodationUpdate,
      })

      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'REVIEW_APPROVED',
          entityType: 'accommodation',
          entityId: accommodationId,
          before: { pendingListingIds: pendingListings.map((listing) => listing.id) },
          after: { approvedListingIds: pendingListings.map((listing) => listing.id) },
        },
      })

      return { accommodation: updatedAccommodation, approvedListingIds: pendingListings.map((listing) => listing.id) }
    })

    return json(res, 200, { ok: true, ...result })
  }

  const reviewMatch = url.pathname.match(/^\/api\/admin\/review-queue\/([^/]+)\/([^/]+)$/)
  if (reviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const [entityType, entityId] = reviewMatch.slice(1)
    const decision = normalizeDecision(body.decision || body.action)
    const result = await db().$transaction(async (tx) => {
      const before = await findReviewEntity(tx, entityType, entityId)
      const after = await updateReviewEntity(tx, entityType, entityId, decision, context.user.id, body)
      const auditLog = await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `REVIEW_${decision}`,
          entityType,
          entityId,
          before: before || {},
          after: after || {},
        },
      })
      return { entity: after, auditLog }
    })
    return json(res, 200, { ok: true, ...result })
  }

  // ---- SR SAFETY (014): SOS triage ----
  if (url.pathname === '/api/admin/sos') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const sos = await db().sosEvent.findMany({
      where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 100,
      include: {
        raisedBy: { select: { id: true, displayName: true } },
        ride: {
          select: {
            id: true, status: true, riderId: true, driverId: true,
            rider: { select: { id: true, displayName: true, email: true } },
            driver: { select: { id: true, displayName: true, email: true } },
          },
        },
      },
    })
    return json(res, 200, { ok: true, sos })
  }

  // ---- FLEET (020): driver directory — paginated, filterable, for operating a large fleet ----
  if (url.pathname === '/api/admin/drivers') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const params = url.searchParams
    const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get('pageSize') || '25', 10) || 25))
    const statusFilter = params.get('status') // ACTIVE | SUSPENDED | DELETED
    const verifiedFilter = params.get('verified') // 'true' | 'false'
    const search = (params.get('search') || '').trim()

    const where = {
      roles: { some: { role: 'DRIVER' } },
      ...(['ACTIVE', 'SUSPENDED', 'DELETED'].includes(statusFilter) ? { status: statusFilter } : {}),
      ...(verifiedFilter === 'true' ? { idDocumentStatus: 'APPROVED' } : {}),
      ...(verifiedFilter === 'false' ? { NOT: { idDocumentStatus: 'APPROVED' } } : {}),
      ...(search ? { OR: [{ displayName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
    }

    const [total, drivers] = await Promise.all([
      db().user.count({ where }),
      db().user.findMany({
        where,
        select: { id: true, displayName: true, email: true, status: true, idDocumentStatus: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return json(res, 200, { ok: true, drivers, page, pageSize, total, pages: Math.ceil(total / pageSize) })
  }

  // ---- FLEET (020): suspend / reinstate / remove a driver account (the fleet kill switch) ----
  const driverStatusMatch = url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/status$/)
  if (driverStatusMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const nextStatus = String(body.status || '').toUpperCase()
    if (!['ACTIVE', 'SUSPENDED', 'DELETED'].includes(nextStatus)) {
      const error = new Error('status must be ACTIVE, SUSPENDED, or DELETED.')
      error.statusCode = 400
      error.code = 'ACCOUNT_STATUS_INVALID'
      error.expose = true
      throw error
    }
    const reason = body.reason ? assertBoundedString(body.reason, { fieldName: 'reason', maxLength: 500 }) : null
    const driver = await db().user.findFirst({ where: { id: driverStatusMatch[1], roles: { some: { role: 'DRIVER' } } } })
    if (!driver) {
      const error = new Error('Driver not found.')
      error.statusCode = 404
      error.code = 'DRIVER_NOT_FOUND'
      error.expose = true
      throw error
    }
    const updated = await db().$transaction(async (tx) => {
      // Bumping sessionVersion on suspend/remove instantly invalidates the driver's existing tokens, so a
      // suspended driver is logged out on their next request — not just blocked at next login.
      const bumpSession = nextStatus !== 'ACTIVE'
      const u = await tx.user.update({
        where: { id: driver.id },
        data: { status: nextStatus, ...(bumpSession ? { sessionVersion: { increment: 1 } } : {}) },
        select: { id: true, status: true },
      })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `DRIVER_STATUS_${nextStatus}`,
          entityType: 'users',
          entityId: driver.id,
          before: { status: driver.status },
          after: { status: nextStatus, reason },
        },
      })
      return u
    })
    return json(res, 200, { ok: true, driver: updated })
  }

  // ---- FLEET (020): full driver record — profile, vehicles, verification, and computed standing ----
  const driverRecordMatch = url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)$/)
  if (driverRecordMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const driverId = driverRecordMatch[1]
    const driver = await db().user.findFirst({
      where: { id: driverId, roles: { some: { role: 'DRIVER' } } },
      select: {
        id: true, displayName: true, email: true, status: true, idDocumentStatus: true, createdAt: true,
        driverProfile: { select: { payoutMethod: true, payoutAccountRef: true } },
        driverVehicles: { orderBy: { createdAt: 'desc' } },
        driverDocuments: { select: { id: true, type: true, status: true, reviewedAt: true } },
      },
    })
    if (!driver) {
      const error = new Error('Driver not found.')
      error.statusCode = 404
      error.code = 'DRIVER_NOT_FOUND'
      error.expose = true
      throw error
    }
    const [ratingAgg, completedRides, driverCancellations] = await Promise.all([
      db().rideRating.aggregate({ where: { ratedUserId: driverId, raterRole: 'RIDER' }, _avg: { stars: true }, _count: { _all: true } }),
      db().rideRequest.count({ where: { driverId, status: 'COMPLETED' } }),
      db().driverCancellation.count({ where: { driverId } }),
    ])
    const standing = computeDriverStanding({
      ratingAvg: ratingAgg._avg.stars,
      ratingCount: ratingAgg._count._all,
      completedRides,
      driverCancellations,
    })
    return json(res, 200, { ok: true, driver, standing })
  }

  // ---- FLEET (020): admin approves / rejects a vehicle (age gate re-checked on approval) ----
  const vehicleReviewMatch = url.pathname.match(/^\/api\/admin\/vehicles\/([^/]+)$/)
  if (vehicleReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const body = await readJson(req)
    const decision = String(body.decision || body.action || '').toUpperCase()
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      const error = new Error('decision must be APPROVED or REJECTED.')
      error.statusCode = 400
      error.code = 'VEHICLE_DECISION_INVALID'
      error.expose = true
      throw error
    }
    const note = body.note ? assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 }) : null
    const vehicle = await db().driverVehicle.findUnique({ where: { id: vehicleReviewMatch[1] } })
    if (!vehicle) {
      const error = new Error('Vehicle not found.')
      error.statusCode = 404
      error.code = 'VEHICLE_NOT_FOUND'
      error.expose = true
      throw error
    }
    // Re-run the age gate at approval time — a car that has aged past its tier's limit since submission
    // (or a tier changed underneath it) can never be approved into the fleet.
    if (decision === 'APPROVED') assertVehicleEligible(vehicle)
    const updated = await db().driverVehicle.update({
      where: { id: vehicle.id },
      data: { status: decision, reviewedById: context.user.id, reviewedAt: new Date(), reviewNote: note },
    })
    return json(res, 200, { ok: true, vehicle: updated })
  }

  // ---- SR CANCELLATION (019): a driver's cancellation record, for accountability review ----
  const driverCancellationsMatch = url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/cancellations$/)
  if (driverCancellationsMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const driverId = driverCancellationsMatch[1]
    const [count, recent] = await Promise.all([
      db().driverCancellation.count({ where: { driverId } }),
      db().driverCancellation.findMany({
        where: { driverId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, rideId: true, reason: true, createdAt: true },
      }),
    ])
    return json(res, 200, { ok: true, driverId, count, recent })
  }

  const sosResolveMatch = url.pathname.match(/^\/api\/admin\/sos\/([^/]+)\/resolve$/)
  if (sosResolveMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const note = assertBoundedString(body.note, { fieldName: 'note', maxLength: 500 })
    const existing = await db().sosEvent.findUnique({ where: { id: sosResolveMatch[1] } })
    if (!existing) {
      const error = new Error('SOS event not found.')
      error.statusCode = 404
      error.code = 'SOS_NOT_FOUND'
      error.expose = true
      throw error
    }
    const updated = await db().sosEvent.updateMany({
      where: { id: existing.id, status: 'OPEN' },
      data: { status: 'RESOLVED', resolvedById: context.user.id, resolvedAt: new Date() },
    })
    if (updated.count === 0) {
      const error = new Error('This SOS event is no longer open.')
      error.statusCode = 409
      error.code = 'SOS_NOT_OPEN'
      error.expose = true
      throw error
    }
    const sosEvent = await db().sosEvent.findUnique({ where: { id: existing.id } })
    await db().adminAuditLog.create({
      data: { actorUserId: context.user.id, action: 'SR_SOS_RESOLVED', entityType: 'sos_events', entityId: sosEvent.id, before: existing, after: note ? { ...sosEvent, resolutionNote: note } : sosEvent },
    })
    return json(res, 200, { ok: true, sosEvent })
  }

  // ---- SR TRUST (015): driver document review ----
  const adminDriverDocFileMatch = url.pathname.match(/^\/api\/admin\/driver-documents\/([^/]+)\/file$/)
  if (adminDriverDocFileMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const document = await db().driverDocument.findUnique({ where: { id: adminDriverDocFileMatch[1] }, select: { assetUrl: true, mimeType: true } })
    if (!document) {
      const error = new Error('Driver document not found.')
      error.statusCode = 404
      error.code = 'DRIVER_DOCUMENT_NOT_FOUND'
      error.expose = true
      throw error
    }
    const buffer = await readDriverDocument(document.assetUrl)
    res.writeHead(200, { 'content-type': document.mimeType || 'application/octet-stream', 'cache-control': 'private, no-store' })
    res.end(buffer)
    return true
  }

  const driverDocReviewMatch = url.pathname.match(/^\/api\/admin\/driver-documents\/([^/]+)$/)
  if (driverDocReviewMatch) {
    if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const decision = normalizeDecision(body.decision || body.action)
    const documentId = driverDocReviewMatch[1]
    const result = await db().$transaction(async (tx) => {
      const before = await tx.driverDocument.findUnique({ where: { id: documentId }, select: { id: true, driverUserId: true, type: true, status: true } })
      if (!before || before.status !== 'PENDING_REVIEW') throw reviewStateError('DRIVER_DOCUMENT_NOT_REVIEWABLE')
      const updated = await tx.driverDocument.updateMany({
        where: { id: documentId, status: 'PENDING_REVIEW' },
        data: { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED', reviewedById: context.user.id, reviewedAt: new Date() },
      })
      if (updated.count === 0) throw reviewStateError('DRIVER_DOCUMENT_NOT_REVIEWABLE')
      const after = await tx.driverDocument.findUnique({ where: { id: documentId }, select: { id: true, driverUserId: true, type: true, status: true, reviewedById: true, reviewedAt: true } })
      await tx.adminAuditLog.create({ data: { actorUserId: context.user.id, action: `DRIVER_DOCUMENT_${decision}`, entityType: 'driver_documents', entityId: documentId, before, after } })
      return after
    })
    return json(res, 200, { ok: true, document: result })
  }

  // ---- SR MONEY (016): driver Sham-Cash payout ----
  const srPayoutReleaseMatch = url.pathname.match(/^\/api\/admin\/sr-payouts\/([^/]+)\/release$/)
  if (srPayoutReleaseMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const driverId = srPayoutReleaseMatch[1]
    const body = await readJson(req)
    const currency = body.currency === 'USD' ? 'USD' : 'SYP'
    const payoutRef = String(body.payoutRef || body.shamCashRef || '').trim()
    if (!payoutRef) {
      const error = new Error('A payoutRef (e.g. the Sham Cash transaction reference) is required so payouts are idempotent.')
      error.statusCode = 400
      error.code = 'SR_PAYOUT_REF_REQUIRED'
      error.expose = true
      throw error
    }
    const driver = await db().user.findFirst({ where: { id: driverId, roles: { some: { role: 'DRIVER' } } }, include: { driverProfile: true } })
    if (!driver) {
      const error = new Error('Driver not found.')
      error.statusCode = 404
      error.code = 'DRIVER_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!driver.driverProfile?.payoutMethod || !driver.driverProfile?.payoutAccountRef) {
      const error = new Error('This driver has no payout method on file. Add a Sham Cash payout method before releasing a payout.')
      error.statusCode = 400
      error.code = 'PAYOUT_METHOD_REQUIRED'
      error.expose = true
      throw error
    }
    const entry = await db().$transaction(async (tx) => {
      const key = idempotencyKey(['sr-driver-payout', driverId, payoutRef])
      const existingPayout = await tx.walletEntry.findUnique({ where: { idempotencyKey: key } })
      if (existingPayout) return existingPayout
      // Serialize on the SAME per-(user,currency) wallet lock as lockWalletForSpend, so an admin SR
      // payout and a concurrent rider-side spend by the same user (one person can be rider + driver)
      // mutually exclude on their shared wallet and can't both pass a balance check on the same balance.
      await lockWalletForSpend(tx, driverId, currency)
      const wallet = await tx.wallet.findUnique({ where: { userId_currency: { userId: driverId, currency } } })
      // RELEASABLE SR EARNINGS ONLY — never the raw wallet balance. A user can be BOTH rider + driver, so
      // cachedBalanceMinor commingles their SR earnings with their own rider top-ups, gifts, referral
      // rewards, etc. Paying out the raw balance would cash out rider credit as "earnings" and could drain
      // funds reserved for the user's own in-flight ride. Releasable = (earnings + tips + cancellation
      // payouts credited) − (already paid out), then floored at the wallet's actual balance so we never
      // overdraw if the driver already spent earnings on their own rides.
      // WalletEntry belongs to a Wallet (walletId → Wallet.userId), so scope the ledger sums by the
      // driver's wallet id. No wallet yet ⇒ nothing releasable.
      let releasableMinor = 0
      if (wallet) {
        const [earnedAgg, paidAgg] = await Promise.all([
          tx.walletEntry.aggregate({
            _sum: { amountMinor: true },
            where: { walletId: wallet.id, type: 'CREDIT', referenceType: { in: ['sr_driver_earning', 'sr_driver_tip', 'sr_cancellation_payout'] } },
          }),
          tx.walletEntry.aggregate({
            _sum: { amountMinor: true },
            where: { walletId: wallet.id, type: 'DEBIT', referenceType: 'sr_driver_payout' },
          }),
        ])
        releasableMinor = Math.max(0, (earnedAgg._sum.amountMinor || 0) - (paidAgg._sum.amountMinor || 0))
      }
      const accruedMinor = Math.min(releasableMinor, wallet?.cachedBalanceMinor || 0)
      const requestedMinor = body.amountMinor != null ? Math.max(0, Math.round(Number(body.amountMinor) || 0)) : accruedMinor
      if (requestedMinor <= 0) {
        const error = new Error('This driver has no accrued SR earnings to pay out.')
        error.statusCode = 400
        error.code = 'SR_PAYOUT_NOTHING_TO_PAY'
        error.expose = true
        throw error
      }
      if (requestedMinor > accruedMinor) {
        const error = new Error('Payout exceeds the driver’s accrued SR earnings.')
        error.statusCode = 400
        error.code = 'SR_PAYOUT_EXCEEDS_ACCRUED'
        error.expose = true
        throw error
      }
      const released = await recordWalletEntry(tx, {
        userId: driverId, type: 'DEBIT', amountMinor: requestedMinor, currency,
        referenceType: 'sr_driver_payout', referenceId: driverId,
        keyParts: ['sr-driver-payout', driverId, payoutRef],
        note: `SR driver earnings paid out via Sham Cash (${driver.driverProfile.payoutMethod}:${driver.driverProfile.payoutAccountRef}); ref ${payoutRef}.`,
      })
      await tx.adminAuditLog.create({
        data: { actorUserId: context.user.id, action: 'ADMIN_SR_PAYOUT_RELEASED', entityType: 'users', entityId: driverId, before: { accruedMinor, currency, payoutRef }, after: { walletEntry: released } },
      })
      return released
    })
    return json(res, 200, { ok: true, walletEntry: entry })
  }

  // ========================================================================
  // ADMIN REMEDIATION — platform-policing controls (all ADMIN, all audited).
  // ========================================================================

  // ---- A1: suspend / reinstate / close ANY user (generalizes the driver kill switch) ----
  const userStatusMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/)
  if (userStatusMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const nextStatus = String(body.status || '').toUpperCase()
    if (!['ACTIVE', 'SUSPENDED', 'CLOSED'].includes(nextStatus)) {
      const error = new Error('status must be ACTIVE, SUSPENDED, or CLOSED.')
      error.statusCode = 400
      error.code = 'ACCOUNT_STATUS_INVALID'
      error.expose = true
      throw error
    }
    const reason = body.reason ? assertBoundedString(body.reason, { fieldName: 'reason', maxLength: 500 }) : null
    const target = await db().user.findUnique({ where: { id: userStatusMatch[1] }, select: { id: true, status: true } })
    if (!target) {
      const error = new Error('User not found.')
      error.statusCode = 404
      error.code = 'USER_NOT_FOUND'
      error.expose = true
      throw error
    }
    // An admin must not lock themselves out mid-action.
    if (target.id === context.user.id && nextStatus !== 'ACTIVE') {
      const error = new Error('You cannot suspend or close your own admin account.')
      error.statusCode = 400
      error.code = 'CANNOT_CHANGE_OWN_STATUS'
      error.expose = true
      throw error
    }
    const updated = await db().$transaction(async (tx) => {
      // Bumping sessionVersion instantly invalidates the user's existing tokens (getAuthContext also
      // rejects any non-ACTIVE user), so a suspended/closed user is logged out on their next request.
      const bumpSession = nextStatus !== 'ACTIVE'
      const u = await tx.user.update({
        where: { id: target.id },
        data: { status: nextStatus, ...(bumpSession ? { sessionVersion: { increment: 1 } } : {}) },
        select: { id: true, status: true, displayName: true },
      })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `USER_STATUS_${nextStatus}`,
          entityType: 'users',
          entityId: target.id,
          before: { status: target.status },
          after: { status: nextStatus, reason },
        },
      })
      return u
    })
    return json(res, 200, { ok: true, user: updated })
  }

  // ---- A4: user directory / search (all roles) ----
  if (url.pathname === '/api/admin/users') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 25))
    const search = (url.searchParams.get('search') || '').trim()
    const roleFilter = String(url.searchParams.get('role') || '').toUpperCase()
    const statusFilter = String(url.searchParams.get('status') || '').toUpperCase()
    const where = {
      ...(['ACTIVE', 'SUSPENDED', 'CLOSED', 'DELETED'].includes(statusFilter) ? { status: statusFilter } : {}),
      ...(['GUEST', 'HOST', 'SELLER', 'DRIVER', 'ADMIN', 'SUPPORT'].includes(roleFilter) ? { roles: { some: { role: roleFilter } } } : {}),
      ...(search ? { OR: [{ displayName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {}),
    }
    const [total, users] = await Promise.all([
      db().user.count({ where }),
      db().user.findMany({
        where,
        select: { id: true, displayName: true, email: true, status: true, idDocumentStatus: true, createdAt: true, roles: { select: { role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return json(res, 200, {
      ok: true,
      users: users.map((user) => ({ ...user, roles: user.roles.map((entry) => entry.role) })),
      page,
      pageSize,
      total,
      pages: Math.ceil(total / pageSize),
    })
  }

  // ---- A2: take down / pause / restore a listing (already-APPROVED → PAUSED/REJECTED/EXPIRED) ----
  const listingStatusMatch = url.pathname.match(/^\/api\/admin\/listings\/([^/]+)\/status$/)
  if (listingStatusMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const nextStatus = String(body.status || '').toUpperCase()
    // NB: the ListingStatus enum has no REMOVED — PAUSED is the take-down (search filters on APPROVED,
    // so PAUSED/REJECTED/EXPIRED all remove the listing from search); APPROVED restores it.
    if (!['APPROVED', 'PAUSED', 'REJECTED', 'EXPIRED'].includes(nextStatus)) {
      const error = new Error('status must be APPROVED, PAUSED, REJECTED, or EXPIRED.')
      error.statusCode = 400
      error.code = 'LISTING_STATUS_INVALID'
      error.expose = true
      throw error
    }
    const reason = body.reason ? assertBoundedString(body.reason, { fieldName: 'reason', maxLength: 500 }) : null
    const listing = await db().listing.findUnique({ where: { id: listingStatusMatch[1] }, select: { id: true, status: true } })
    if (!listing) {
      const error = new Error('Listing not found.')
      error.statusCode = 404
      error.code = 'LISTING_NOT_FOUND'
      error.expose = true
      throw error
    }
    const updated = await db().$transaction(async (tx) => {
      const u = await tx.listing.update({ where: { id: listing.id }, data: { status: nextStatus }, select: { id: true, status: true } })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: `LISTING_STATUS_${nextStatus}`,
          entityType: 'listings',
          entityId: listing.id,
          before: { status: listing.status },
          after: { status: nextStatus, reason },
        },
      })
      return u
    })
    return json(res, 200, { ok: true, listing: updated })
  }

  // ---- A3: force-cancel + refund ANY booking (CONFIRMED or PAYMENT_PENDING) ----
  // Reuses the exact refund helpers the guest-cancel path uses (bookingFinanceSplit,
  // originalAdminShareRecipient, recordWalletEntry, lockWalletForSpend, debitableMinor). TOCTOU-safe
  // (atomic status-claim), idempotent (ledger keys are per-booking, and a repeat hits 400/409), audited.
  const bookingCancelMatch = url.pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/cancel$/)
  if (bookingCancelMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const bookingId = bookingCancelMatch[1]
    const body = await readJson(req).catch(() => ({}))
    const reason = body.reason ? assertBoundedString(body.reason, { fieldName: 'reason', maxLength: 500 }) : null

    const existing = await db().booking.findUnique({ where: { id: bookingId }, include: { listing: true, payments: true } })
    if (!existing) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    if (!['CONFIRMED', 'PAYMENT_PENDING'].includes(existing.status)) {
      const error = new Error('Only a CONFIRMED or PAYMENT_PENDING booking can be force-cancelled.')
      error.statusCode = 400
      error.code = 'BOOKING_NOT_CANCELLABLE'
      error.expose = true
      throw error
    }

    // A card (Stripe) payment is refunded to the CARD after the transaction commits (never call Stripe
    // inside a DB transaction); populated in the tx, acted on after.
    let deferredCardRefund = null

    const result = await db().$transaction(async (tx) => {
      // Atomically claim the cancel on the expected statuses so concurrent guest-cancel / dispute-refund
      // / host-confirm all lose the race (they claim on their own statuses and match zero rows).
      const claim = await tx.booking.updateMany({
        where: { id: existing.id, status: { in: ['CONFIRMED', 'PAYMENT_PENDING'] } },
        data: { status: 'CANCELLED' },
      })
      if (claim.count !== 1) {
        const error = new Error('This booking was already updated and can no longer be force-cancelled.')
        error.statusCode = 409
        error.code = 'BOOKING_CANCEL_CONFLICT'
        error.expose = true
        throw error
      }

      const approvedPayment = existing.payments.find((payment) => payment.status === 'APPROVED')
      let refundMinor = 0
      if (approvedPayment) {
        const split = bookingFinanceSplit(existing, approvedPayment.amountMinor)
        // Refund exactly what was actually paid (capped) — an admin/consumer-protection cancel, no fee.
        refundMinor = approvedPayment.amountMinor
        const adminRecipientId = await originalAdminShareRecipient(tx, existing.id)

        await tx.paymentProof.updateMany({
          where: { bookingId: existing.id, status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] } },
          data: {
            status: 'REFUNDED',
            adminNote: `Admin force-cancelled the booking${reason ? `: ${reason}` : ''}.`,
            reviewedById: context.user.id,
            reviewedAt: new Date(),
          },
        })

        // Guest refund — to the CARD if paid by Stripe (deferred to after commit), else internal wallet
        // credit for Sham Cash. Keyed on the booking so it can only ever fire ONCE.
        const stripeIntentId =
          approvedPayment.provider === 'stripe' ? extractStripePaymentIntentId(approvedPayment.proofAssetUrl) : null
        if (stripeIntentId && refundMinor > 0 && isStripeConfigured()) {
          deferredCardRefund = {
            paymentIntentId: stripeIntentId,
            amountMinor: refundMinor,
            currency: existing.currency,
            bookingId: existing.id,
            guestId: existing.guestId,
          }
        } else {
          await recordWalletEntry(tx, {
            userId: existing.guestId,
            type: 'REFUND',
            amountMinor: refundMinor,
            currency: existing.currency,
            referenceType: 'booking_refund',
            referenceId: existing.id,
            keyParts: ['admin-force-cancel-refund', existing.id],
            note: 'Admin force-cancelled the booking and refunded the guest.',
          })
        }

        // Reverse the platform's admin-share, capped at what the recipient can actually give back.
        if (adminRecipientId) {
          await lockWalletForSpend(tx, adminRecipientId, existing.currency)
          const revMinor = await debitableMinor(tx, adminRecipientId, existing.currency, split.adminShareMinor)
          if (revMinor > 0) {
            await recordWalletEntry(tx, {
              userId: adminRecipientId,
              type: 'DEBIT',
              amountMinor: revMinor,
              currency: existing.currency,
              referenceType: 'booking_admin_share_reversal',
              referenceId: existing.id,
              keyParts: ['admin-force-cancel-admin-share-reversal', existing.id],
              note: 'Admin/SYBNB share reversed after admin force-cancelled the booking.',
            })
          }
        }

        // Claw back the host payout if it was ALREADY released (defensive — normally a CONFIRMED
        // booking's payout is only HELD, never released, but never leave money out if it was).
        const releasedPayout = await tx.walletEntry.findFirst({
          where: { referenceType: 'booking_payout', referenceId: existing.id, type: 'RELEASE' },
        })
        if (releasedPayout) {
          const hostId = existing.listing.ownerId
          await lockWalletForSpend(tx, hostId, existing.currency)
          const clawMinor = await debitableMinor(tx, hostId, existing.currency, releasedPayout.amountMinor)
          if (clawMinor > 0) {
            await recordWalletEntry(tx, {
              userId: hostId,
              type: 'DEBIT',
              amountMinor: clawMinor,
              currency: existing.currency,
              referenceType: 'booking_payout_clawback',
              referenceId: existing.id,
              keyParts: ['admin-force-cancel-payout-clawback', existing.id],
              note: 'Host payout clawed back after admin force-cancelled the booking.',
            })
          }
        }
      }

      // Booking is already CANCELLED (the claim above) — CANCELLED is excluded from the availability
      // "booked" set, so the held dates are released automatically.
      const updated = await tx.booking.findUnique({ where: { id: existing.id }, include: { listing: true, payments: true } })
      await tx.adminAuditLog.create({
        data: {
          actorUserId: context.user.id,
          action: 'ADMIN_BOOKING_FORCE_CANCELLED',
          entityType: 'bookings',
          entityId: existing.id,
          before: { status: existing.status },
          after: { status: 'CANCELLED', refundMinor, currency: existing.currency, reason },
        },
      })
      return updated
    })

    // Real card refund runs AFTER the transaction commits. If Stripe fails, fall back to a wallet credit
    // so the guest is still made whole, and log it for follow-up.
    if (deferredCardRefund) {
      try {
        const refund = await createStripeCardRefund({
          paymentIntentId: deferredCardRefund.paymentIntentId,
          amountMinor: deferredCardRefund.amountMinor,
          bookingCurrency: deferredCardRefund.currency,
        })
        await db().adminAuditLog.create({
          data: {
            actorUserId: context.user.id,
            action: 'BOOKING_CARD_REFUNDED',
            entityType: 'bookings',
            entityId: deferredCardRefund.bookingId,
            after: { stripeRefundId: refund.refundId || null, amountMinor: deferredCardRefund.amountMinor, currency: deferredCardRefund.currency, via: 'admin_force_cancel' },
          },
        })
      } catch (refundError) {
        console.error('[sybnb] Stripe card refund failed after admin force-cancel; crediting wallet as fallback:', refundError?.message || refundError)
        await recordWalletEntry(db(), {
          userId: deferredCardRefund.guestId,
          type: 'REFUND',
          amountMinor: deferredCardRefund.amountMinor,
          currency: deferredCardRefund.currency,
          referenceType: 'booking_refund',
          referenceId: deferredCardRefund.bookingId,
          keyParts: ['admin-force-cancel-refund-card-fallback', deferredCardRefund.bookingId],
          note: 'Fallback wallet refund — the Stripe card refund could not be completed.',
        })
      }
    }

    return json(res, 200, { ok: true, booking: result })
  }

  // ---- A3b: manual payout hold / release-hold ----
  // Persists metadata.payoutHeld on the booking. The payout-release endpoint (above) refuses to release
  // while this is true — so "Hold payout" actually stops the money instead of being a UI-only note.
  const payoutHoldMatch = url.pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/payout-hold$/)
  if (payoutHoldMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req).catch(() => ({}))
    const held = body.held !== false // default true (explicit false removes the hold)
    const booking = await db().booking.findUnique({ where: { id: payoutHoldMatch[1] } })
    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    await db().booking.update({
      where: { id: booking.id },
      data: { metadata: { ...(booking.metadata && typeof booking.metadata === 'object' ? booking.metadata : {}), payoutHeld: held } },
    })
    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: held ? 'ADMIN_PAYOUT_HELD' : 'ADMIN_PAYOUT_HOLD_REMOVED',
        entityType: 'bookings',
        entityId: booking.id,
        after: { payoutHeld: held },
      },
    })
    return json(res, 200, { ok: true, bookingId: booking.id, payoutHeld: held })
  }

  // ---- A3c: admin note into a booking's message thread (visible to guest + host in that booking) ----
  const adminMessageMatch = url.pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/message$/)
  if (adminMessageMatch) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
    requireAuth(context, ['ADMIN'])
    const body = await readJson(req)
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (!text) {
      const error = new Error('Message body is required.')
      error.statusCode = 400
      error.code = 'MESSAGE_BODY_REQUIRED'
      error.expose = true
      throw error
    }
    if (text.length > 4000) {
      const error = new Error('Message body is too long.')
      error.statusCode = 400
      error.code = 'MESSAGE_BODY_TOO_LONG'
      error.expose = true
      throw error
    }
    const booking = await db().booking.findUnique({ where: { id: adminMessageMatch[1] } })
    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    // Reuse an existing thread (booking- or listing/guest-keyed) or create the booking thread. findFirst
    // avoids colliding with the [listingId, guestId] unique constraint if the guest inquired pre-booking.
    let thread = await db().messageThread.findFirst({
      where: { OR: [{ bookingId: booking.id }, { listingId: booking.listingId, guestId: booking.guestId }] },
    })
    if (!thread) {
      thread = await db().messageThread.create({
        data: { bookingId: booking.id, listingId: booking.listingId, guestId: booking.guestId },
      })
    }
    const message = await db().message.create({
      data: { threadId: thread.id, senderUserId: context.user.id, senderRole: 'ADMIN', body: text },
      include: { sender: { select: { id: true, displayName: true } } },
    })
    await db().adminAuditLog.create({
      data: {
        actorUserId: context.user.id,
        action: 'ADMIN_BOOKING_MESSAGE_SENT',
        entityType: 'bookings',
        entityId: booking.id,
        after: { target: body.target === 'host' ? 'host' : 'guest', messageId: message.id },
      },
    })
    return json(res, 201, { ok: true, message })
  }

  // ---- A4: single booking lookup ----
  const bookingLookupMatch = url.pathname.match(/^\/api\/admin\/bookings\/([^/]+)$/)
  if (bookingLookupMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const booking = await db().booking.findUnique({
      where: { id: bookingLookupMatch[1] },
      include: {
        listing: { select: { id: true, titleAr: true, titleEn: true, ownerId: true, currency: true } },
        guest: { select: { id: true, displayName: true, email: true } },
        payments: { select: { id: true, status: true, amountMinor: true, currency: true, provider: true, createdAt: true } },
      },
    })
    if (!booking) {
      const error = new Error('Booking not found.')
      error.statusCode = 404
      error.code = 'BOOKING_NOT_FOUND'
      error.expose = true
      throw error
    }
    return json(res, 200, { ok: true, booking })
  }

  // ---- A4: booking directory / search (status / host / guest / date) ----
  if (url.pathname === '/api/admin/bookings') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 25))
    const statusFilter = String(url.searchParams.get('status') || '').toUpperCase()
    const hostId = (url.searchParams.get('hostId') || '').trim()
    const guestId = (url.searchParams.get('guestId') || '').trim()
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const createdAt = {}
    if (from && !Number.isNaN(Date.parse(from))) createdAt.gte = new Date(from)
    if (to && !Number.isNaN(Date.parse(to))) createdAt.lte = new Date(to)
    const where = {
      ...(['DRAFT', 'REQUESTED', 'PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'DISPUTED'].includes(statusFilter) ? { status: statusFilter } : {}),
      ...(guestId ? { guestId } : {}),
      ...(hostId ? { listing: { ownerId: hostId } } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    }
    const [total, bookings] = await Promise.all([
      db().booking.count({ where }),
      db().booking.findMany({
        where,
        select: {
          id: true, status: true, amountMinor: true, currency: true, checkIn: true, checkOut: true, createdAt: true,
          listing: { select: { id: true, titleAr: true, titleEn: true, ownerId: true } },
          guest: { select: { id: true, displayName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return json(res, 200, { ok: true, bookings, page, pageSize, total, pages: Math.ceil(total / pageSize) })
  }

  // ---- B: NEEDS-ATTENTION board (READ-ONLY, ADMIN/SUPPORT) ----
  if (url.pathname === '/api/admin/needs-attention') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    requireAuth(context, ['ADMIN', 'SUPPORT'])

    const STUCK_PAYMENT_HOURS = 2
    const AGING_HOURS = 48
    const stuckCutoff = new Date(Date.now() - STUCK_PAYMENT_HOURS * 60 * 60 * 1000)
    const agingCutoff = new Date(Date.now() - AGING_HOURS * 60 * 60 * 1000)

    const [stuckBookings, positiveWallets, openReview, openDisputes, openSos] = await Promise.all([
      // (a) bookings stuck in PAYMENT_PENDING past the threshold
      db().booking.findMany({
        where: { status: 'PAYMENT_PENDING', createdAt: { lt: stuckCutoff } },
        select: { id: true, createdAt: true, currency: true, amountMinor: true, listing: { select: { titleAr: true, ownerId: true } } },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
      // (b) + (c) source rows: every wallet with a positive balance, plus its owner + entries
      db().wallet.findMany({
        where: { cachedBalanceMinor: { gt: 0 } },
        select: {
          id: true, currency: true, cachedBalanceMinor: true,
          user: { select: { id: true, displayName: true, payoutMethod: true, roles: { select: { role: true } } } },
          entries: { select: { type: true, amountMinor: true } },
        },
        take: 500,
      }),
      db().listing.count({ where: { status: 'PENDING_REVIEW', updatedAt: { lt: agingCutoff } } }),
      db().dispute.count({ where: { status: 'OPEN', createdAt: { lt: agingCutoff } } }),
      db().sosEvent.count({ where: { status: 'OPEN', createdAt: { lt: agingCutoff } } }),
    ])

    // (b) hosts/sellers holding money but with NO payout method on file.
    const noPayoutMethodHosts = positiveWallets
      .filter((wallet) =>
        wallet.user &&
        !wallet.user.payoutMethod &&
        wallet.user.roles.some((entry) => entry.role === 'HOST' || entry.role === 'SELLER'),
      )
      .map((wallet) => ({
        userId: wallet.user.id,
        displayName: wallet.user.displayName,
        currency: wallet.currency,
        cachedBalanceMinor: wallet.cachedBalanceMinor,
      }))

    // (c) ledger-integrity: cachedBalanceMinor must equal the signed sum of its entries' deltas.
    const imbalancedWallets = positiveWallets
      .map((wallet) => {
        const computed = wallet.entries.reduce((sum, entry) => {
          if (entry.type === 'CREDIT' || entry.type === 'RELEASE' || entry.type === 'REFUND') return sum + entry.amountMinor
          if (entry.type === 'DEBIT') return sum - entry.amountMinor
          return sum
        }, 0)
        return { walletId: wallet.id, userId: wallet.user?.id || null, currency: wallet.currency, cachedBalanceMinor: wallet.cachedBalanceMinor, computedBalanceMinor: computed }
      })
      .filter((wallet) => wallet.cachedBalanceMinor !== wallet.computedBalanceMinor)

    const counts = {
      stuckPayments: stuckBookings.length,
      noPayoutMethodHosts: noPayoutMethodHosts.length,
      imbalancedWallets: imbalancedWallets.length,
      agingReviewListings: openReview,
      agingDisputes: openDisputes,
      agingSos: openSos,
    }
    return json(res, 200, {
      ok: true,
      thresholds: { stuckPaymentHours: STUCK_PAYMENT_HOURS, agingHours: AGING_HOURS },
      counts,
      total: counts.stuckPayments + counts.noPayoutMethodHosts + counts.imbalancedWallets + counts.agingReviewListings + counts.agingDisputes + counts.agingSos,
      items: { stuckBookings, noPayoutMethodHosts, imbalancedWallets },
    })
  }

  return false
}

function toCountMap(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = row._count._all
    return acc
  }, {})
}

function normalizeDecision(value) {
  const decision = String(value || 'APPROVE').toUpperCase()
  if (decision === 'APPROVE' || decision === 'APPROVED') return 'APPROVED'
  if (decision === 'REJECT' || decision === 'REJECTED') return 'REJECTED'

  const error = new Error('decision must be APPROVE or REJECT.')
  error.statusCode = 400
  error.code = 'INVALID_REVIEW_DECISION'
  error.expose = true
  throw error
}

const ID_DOCUMENT_SAFE_SELECT = {
  id: true,
  displayName: true,
  email: true,
  idDocumentRef: true,
  idDocumentMimeType: true,
  idDocumentSubmittedAt: true,
  idDocumentStatus: true,
  idDocumentReviewedById: true,
  idDocumentReviewedAt: true,
}

function reviewModel(entityType) {
  const normalized = String(entityType || '').toLowerCase()
  if (normalized === 'listing' || normalized === 'listings') return 'listing'
  if (normalized === 'payment' || normalized === 'payments') return 'paymentProof'
  if (normalized === 'gift' || normalized === 'gifts') return 'walletGift'
  if (normalized === 'booking' || normalized === 'bookings') return 'booking'
  if (normalized === 'iddocument' || normalized === 'iddocuments') return 'user'

  const error = new Error('Unsupported review entity type.')
  error.statusCode = 400
  error.code = 'UNSUPPORTED_REVIEW_ENTITY'
  error.expose = true
  throw error
}

async function findReviewEntity(tx, entityType, entityId) {
  const model = reviewModel(entityType)
  // The 'user' model backs ID-document review — never return the full row (password hash, phone
  // hash) into an audit log or API response; only the fields relevant to document review.
  if (model === 'user') {
    return tx.user.findUnique({ where: { id: entityId }, select: ID_DOCUMENT_SAFE_SELECT })
  }
  return tx[model].findUnique({ where: { id: entityId } })
}

async function updateReviewEntity(tx, entityType, entityId, decision, actorUserId, body) {
  const model = reviewModel(entityType)
  const note = body.adminNote || body.note || undefined

  if (model === 'listing') {
    const existing = await tx.listing.findUnique({ where: { id: entityId } })
    if (!existing || existing.status !== 'PENDING_REVIEW') throw reviewStateError('LISTING_NOT_REVIEWABLE')

    // The paid-plan expiry clock starts HERE, at approval — not at draft-create — so a seller never
    // loses paid days waiting in the review queue. Computed from the owner's current plan at the moment
    // the listing actually goes live.
    const listingUpdate = { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED' }
    if (decision === 'APPROVED' && PAID_PLAN_DIVISIONS.has(existing.division)) {
      const sellerProfile = await tx.sellerProfile.findUnique({ where: { userId: existing.ownerId } })
      listingUpdate.expiresAt = listingExpiryDate(sellerProfile?.planCode)
    }
    // Rentals/Buy (025): commission-based, no paid plan, but still needs a real freshness signal
    // instead of living forever with no "still available?" nudge -- see FREE_TIER_DIVISIONS.
    if (decision === 'APPROVED' && FREE_TIER_DIVISIONS.has(existing.division)) {
      listingUpdate.expiresAt = freeListingExpiryDate()
    }
    // Re-check status in the WHERE clause so two concurrent decisions on the same listing can't
    // both apply (same TOCTOU class as the payment-proof and SR-ride races fixed earlier).
    const updated = await tx.listing.updateMany({
      where: { id: entityId, status: 'PENDING_REVIEW' },
      data: listingUpdate,
    })
    if (updated.count === 0) throw reviewStateError('LISTING_NOT_REVIEWABLE')
    return tx.listing.findUnique({ where: { id: entityId } })
  }

  if (model === 'paymentProof') {
    const existing = await tx.paymentProof.findUnique({
      where: { id: entityId },
      include: {
        booking: {
          include: {
            listing: true,
          },
        },
      },
    })
    if (!existing || existing.status !== 'PENDING_ADMIN_REVIEW') throw reviewStateError('PAYMENT_NOT_REVIEWABLE')
    const shamCashReconciliation = decision === 'APPROVED' && isShamCashProvider(existing.provider)
      ? requireShamCashReconciliation(existing, body)
      : null
    const adminNote = [
      note,
      shamCashReconciliation
        ? `Sham Cash reconciled server-side: expected=${shamCashReconciliation.expectedMinor}, account=${shamCashReconciliation.accountMinor}, difference=${shamCashReconciliation.differenceMinor}, source=${shamCashReconciliation.source}.`
        : '',
    ].filter(Boolean).join('\n') || undefined

    if (decision === 'APPROVED') {
      return approvePaymentProof(tx, { proofId: entityId, actorUserId, note: adminNote })
    }

    const rejectResult = await tx.paymentProof.updateMany({
      where: { id: entityId, status: 'PENDING_ADMIN_REVIEW' },
      data: {
        status: 'REJECTED',
        reviewedById: actorUserId,
        reviewedAt: new Date(),
        adminNote,
      },
    })
    if (rejectResult.count === 0) throw reviewStateError('PAYMENT_REVIEW_CONFLICT')
    const rejected = await tx.paymentProof.findUnique({ where: { id: entityId } })

    if (!existing.bookingId && existing.provider === 'seller_plan') {
      await tx.sellerProfile.update({
        where: { userId: existing.userId },
        data: { documentStatus: 'REJECTED' },
      })
    }

    return rejected
  }

  if (model === 'walletGift') {
    const existing = await tx.walletGift.findUnique({ where: { id: entityId } })
    if (!existing || !['CLAIM_PENDING', 'LOCKED'].includes(existing.status)) throw reviewStateError('GIFT_NOT_REVIEWABLE')
    const updated = await tx.walletGift.updateMany({
      where: { id: entityId, status: existing.status },
      data: { status: decision === 'APPROVED' ? 'SENT' : 'ADMIN_BLOCKED' },
    })
    if (updated.count === 0) throw reviewStateError('GIFT_NOT_REVIEWABLE')
    // A rejected gift (ADMIN_BLOCKED) is a non-claimed terminal state: refund the sender the amount that
    // was reserved from their wallet at send time. Idempotent on the gift id. Approve needs no ledger
    // action — the money was already debited at send and stays reserved until the recipient claims it.
    if (decision !== 'APPROVED') {
      await refundGiftToSender(tx, existing)
    }
    return tx.walletGift.findUnique({ where: { id: entityId } })
  }

  if (model === 'user') {
    const existing = await tx.user.findUnique({ where: { id: entityId }, select: { idDocumentStatus: true } })
    if (!existing || existing.idDocumentStatus !== 'PENDING_REVIEW') throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
    const updated = await tx.user.updateMany({
      where: { id: entityId, idDocumentStatus: 'PENDING_REVIEW' },
      data: {
        idDocumentStatus: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        idDocumentReviewedById: actorUserId,
        idDocumentReviewedAt: new Date(),
      },
    })
    if (updated.count === 0) throw reviewStateError('ID_DOCUMENT_NOT_REVIEWABLE')
    return tx.user.findUnique({ where: { id: entityId }, select: ID_DOCUMENT_SAFE_SELECT })
  }

  const existing = await tx.booking.findUnique({
    where: { id: entityId },
    include: { payments: true, listing: true },
  })
  if (!existing || !['REQUESTED', 'DISPUTED'].includes(existing.status)) throw reviewStateError('BOOKING_NOT_REVIEWABLE')
  const updatedBooking = await tx.booking.updateMany({
    where: { id: entityId, status: existing.status },
    data: { status: decision === 'APPROVED' ? 'CONFIRMED' : 'CANCELLED' },
  })
  if (updatedBooking.count === 0) throw reviewStateError('BOOKING_NOT_REVIEWABLE')

  // Rejecting a REQUESTED booking or ruling against the host in a DISPUTED one both cancel a
  // booking that already has an approved payment (the HOLD/admin-share CREDIT were created back
  // when the payment proof was approved, well before this decision). Without reversing them here,
  // the guest's money and the admin's commission are stranded forever with no other code path that
  // ever cleans them up — this mirrors the guest/host-initiated cancellation reversal in
  // bookings.mjs and host.mjs, but with a full refund (no cancellation fee) since the guest didn't
  // choose to cancel.
  if (decision !== 'APPROVED') {
    const approvedPayment = existing.payments.find((payment) => payment.status === 'APPROVED')
    if (approvedPayment) {
      const split = bookingFinanceSplit(existing, approvedPayment.amountMinor)
      const adminRecipientId = await originalAdminShareRecipient(tx, existing.id)

      await tx.paymentProof.updateMany({
        where: {
          bookingId: existing.id,
          status: { in: ['PENDING_PROOF', 'PENDING_ADMIN_REVIEW', 'APPROVED'] },
        },
        data: {
          status: 'REFUNDED',
          adminNote: 'Auto-refunded after admin rejected/ruled against this booking.',
          reviewedById: actorUserId,
          reviewedAt: new Date(),
        },
      })

      await recordWalletEntry(tx, {
        userId: existing.guestId,
        type: 'REFUND',
        amountMinor: approvedPayment.amountMinor,
        currency: existing.currency,
        referenceType: 'booking_refund',
        referenceId: existing.id,
        keyParts: ['booking-admin-reject-refund', existing.id, approvedPayment.id],
        note: 'Guest refund after admin rejected/ruled against this booking.',
      })

      // Floor the platform-share reversal at the admin wallet's balance so it can't go negative; lock
      // the wallet first so the floor's read-then-write is serialized against concurrent debits.
      await lockWalletForSpend(tx, adminRecipientId, existing.currency)
      const adminShareRevMinor = await debitableMinor(tx, adminRecipientId, existing.currency, split.adminShareMinor)
      if (adminShareRevMinor > 0) {
        await recordWalletEntry(tx, {
          userId: adminRecipientId,
          type: 'DEBIT',
          amountMinor: adminShareRevMinor,
          currency: existing.currency,
          referenceType: 'booking_admin_share_reversal',
          referenceId: existing.id,
          keyParts: ['booking-admin-reject-admin-share-reversal', existing.id, approvedPayment.id],
          note: 'Admin/SYBNB share reversed because the admin rejected/ruled against this booking.',
        })
      }

      // SECURITY (S5): if the host payout was already RELEASED (money moved to the host, only possible on a
      // COMPLETED booking that was later disputed), an adverse ruling must claw it back. Otherwise the guest
      // is refunded in full while the host keeps the released payout and the platform absorbs the loss.
      // Only debit when a RELEASE actually exists; the DEBIT is idempotency-keyed so it can't double-apply.
      const releasedPayout = await tx.walletEntry.findFirst({
        where: { referenceType: 'booking_payout', referenceId: existing.id, type: 'RELEASE' },
      })
      if (releasedPayout) {
        await recordWalletEntry(tx, {
          userId: existing.listing.ownerId,
          type: 'DEBIT',
          amountMinor: split.hostGrossMinor,
          currency: existing.currency,
          referenceType: 'booking_payout_clawback',
          referenceId: existing.id,
          keyParts: ['booking-host-payout-clawback', existing.id, approvedPayment.id],
          note: 'Host payout clawed back after the admin ruled against the host in a dispute.',
        })
      }
    }
  }

  return tx.booking.findUnique({ where: { id: entityId } })
}

function reviewStateError(code) {
  const error = new Error('Entity is not in a reviewable state.')
  error.statusCode = 400
  error.code = code
  error.expose = true
  return error
}

function isShamCashProvider(provider) {
  const value = String(provider || '').toUpperCase()
  return value.includes('SHAM') || value.includes('LOCAL_WALLET') || value.includes('SYRIAN_LOCAL_WALLET')
}

function minorValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : null
}

function requireShamCashReconciliation(paymentProof, body) {
  const packet = body.shamCashReconciliation || body.shamCash || {}
  const accountMinor = minorValue(packet.accountMinor ?? body.shamCashAccountMinor)
  const source = String(packet.source || body.shamCashSource || 'admin-ui')
  // expectedMinor is recomputed from this payment's own row rather than trusted from the client.
  // The admin UI used to send one aggregate figure summed across every pending Sham Cash payment,
  // so reconciling the total let a single balance entry silently "cover" unrelated bookings too —
  // approving one payment could flip another, unreconciled payment's mismatch banner to matched.
  const expectedMinor = Math.round(paymentProof.amountMinor || 0)

  if (accountMinor == null) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_REQUIRED',
      'Sham Cash reconciliation is required before approving this payment.',
      409,
    )
  }

  const differenceMinor = accountMinor - expectedMinor
  if (differenceMinor !== 0) {
    throwShamCashError(
      'SHAM_CASH_RECONCILIATION_MISMATCH',
      'Sham Cash account balance does not match the expected SYBNB payment amount.',
      409,
    )
  }

  return { accountMinor, expectedMinor, differenceMinor, source }
}

function throwShamCashError(code, message, statusCode) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  error.expose = true
  throw error
}
