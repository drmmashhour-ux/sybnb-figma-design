import { db } from './prisma.mjs'
import { isMailerConfigured, sanitizeEmailError, sendTransactionalEmail } from './mailer.mjs'

// SYB-003 — narrow TRANSACTIONAL notifications (approved scope). Email only, reusing the existing mailer.
// NOT a notification platform: no centre, no feed, no preferences, no push, no multi-channel.
//
// Governing principles (owner-approved):
//   - A notification mirrors an authoritative event that has ALREADY committed. It never creates state,
//     approves/rejects anything, or changes a workflow. Callers emit AFTER their transaction commits.
//   - Notification failure NEVER blocks the workflow: notify() is best-effort and never throws.
//   - Every attempt is recorded with a delivery status so "was the user told" is answerable.
//   - A recipient with no email (an anonymous guest — SYB-010) yields NO_CHANNEL, not an error.
//   - Templates carry a reference and status only — never bytes, credentials, or full personal data.

export const NOTIFICATION_AUDIT_ACTION = 'NOTIFICATION_DELIVERY'

export const DELIVERY_STATUS = {
  SENT: 'SENT',
  FAILED: 'FAILED',
  NO_CHANNEL: 'NO_CHANNEL', // recipient has no email address
  SUPPRESSED: 'SUPPRESSED', // mailer not configured (dev/test) — recorded, not attempted
}

// Approved transactional events, each with a bilingual subject + body builder. `d` is safe reference
// data (ids, amounts, status) — never sensitive personal content.
export const TRANSACTIONAL_EVENTS = {
  BOOKING_SUBMITTED: {
    ar: (d) => ({ subject: 'تم استلام طلب الحجز', text: `استلمنا طلب حجزك رقم ${d.ref}. أكمل الدفع لتأكيد الحجز.` }),
    en: (d) => ({ subject: 'Booking request received', text: `We received your booking request ${d.ref}. Complete payment to confirm.` }),
  },
  BOOKING_CONFIRMED: {
    ar: (d) => ({ subject: 'تم تأكيد الحجز', text: `تم تأكيد حجزك رقم ${d.ref}.` }),
    en: (d) => ({ subject: 'Booking confirmed', text: `Your booking ${d.ref} is confirmed.` }),
  },
  BOOKING_CANCELLED: {
    ar: (d) => ({ subject: 'تم إلغاء الحجز', text: `تم إلغاء الحجز رقم ${d.ref}.` }),
    en: (d) => ({ subject: 'Booking cancelled', text: `Booking ${d.ref} has been cancelled.` }),
  },
  PAYMENT_PROOF_RECEIVED: {
    ar: (d) => ({ subject: 'تم استلام إثبات الدفع', text: `استلمنا إثبات الدفع للحجز ${d.ref} وهو قيد المراجعة.` }),
    en: (d) => ({ subject: 'Payment proof received', text: `We received your payment proof for ${d.ref}; it is under review.` }),
  },
  PAYMENT_APPROVED: {
    ar: (d) => ({ subject: 'تمت الموافقة على الدفع', text: `تمت الموافقة على دفعتك للحجز ${d.ref}.` }),
    en: (d) => ({ subject: 'Payment approved', text: `Your payment for ${d.ref} was approved.` }),
  },
  PAYMENT_REJECTED: {
    ar: (d) => ({ subject: 'لم تتم الموافقة على الدفع', text: `لم تتم الموافقة على إثبات الدفع للحجز ${d.ref}. يرجى المحاولة مرة أخرى أو التواصل مع الدعم.` }),
    en: (d) => ({ subject: 'Payment not approved', text: `The payment proof for ${d.ref} was not approved. Please retry or contact support.` }),
  },
  PAYMENT_HOLD_EXPIRED: {
    ar: (d) => ({ subject: 'انتهت مهلة الحجز غير المدفوع', text: `انتهت مهلة الحجز غير المدفوع رقم ${d.ref} وتم تحرير التواريخ. يمكنك الحجز من جديد.` }),
    en: (d) => ({ subject: 'Unpaid hold expired', text: `Your unpaid hold ${d.ref} expired and the dates were released. You can book again.` }),
  },
  PAYOUT_INITIATED: {
    ar: (d) => ({ subject: 'بدء تحويل الدفعة', text: `بدأنا تحويل دفعتك المرجع ${d.ref} يدوياً.` }),
    en: (d) => ({ subject: 'Payout initiated', text: `We have begun your manual payout ${d.ref}.` }),
  },
  PAYOUT_COMPLETED: {
    ar: (d) => ({ subject: 'اكتمل تحويل الدفعة', text: `تم إتمام تحويل دفعتك المرجع ${d.ref}.` }),
    en: (d) => ({ subject: 'Payout completed', text: `Your payout ${d.ref} has been completed.` }),
  },
  ACCOUNT_ACTION: {
    ar: (d) => ({ subject: 'إجراء مهم على حسابك', text: `تم تنفيذ إجراء مهم على حسابك: ${d.ref}.` }),
    en: (d) => ({ subject: 'Important account action', text: `An important action was taken on your account: ${d.ref}.` }),
  },
}

function langFromLocale(locale) {
  return String(locale || '').toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

async function recordDelivery({ event, status, recipientRef, entityId, reason }) {
  try {
    await db().adminAuditLog.create({
      data: {
        actorUserId: null,
        action: NOTIFICATION_AUDIT_ACTION,
        entityType: 'notifications',
        entityId: entityId || event,
        after: { event, status, recipientRef: recipientRef || null, reason: reason || null },
      },
    })
  } catch {
    /* recording the delivery must also never break the workflow */
  }
}

/**
 * Emit one transactional notification. BEST-EFFORT: resolves with a delivery status and NEVER throws,
 * so a mailer outage cannot roll back or block the authoritative workflow that called it.
 *
 * @param event      one of TRANSACTIONAL_EVENTS
 * @param to         recipient email (may be null/undefined -> NO_CHANNEL)
 * @param locale     recipient locale (for language selection)
 * @param data       safe reference data for the template (e.g. { ref })
 * @param entityId   the subject entity id, for the delivery audit
 * @param recipientRef  a non-PII reference for the recipient (e.g. user id), for the delivery audit
 */
export async function notify({ event, to, locale, data = {}, entityId, recipientRef }) {
  const template = TRANSACTIONAL_EVENTS[event]
  if (!template) {
    await recordDelivery({ event: String(event), status: DELIVERY_STATUS.SUPPRESSED, entityId, reason: 'unknown-event' })
    return { status: DELIVERY_STATUS.SUPPRESSED }
  }
  if (!to) {
    await recordDelivery({ event, status: DELIVERY_STATUS.NO_CHANNEL, entityId, recipientRef })
    return { status: DELIVERY_STATUS.NO_CHANNEL }
  }
  if (!isMailerConfigured()) {
    await recordDelivery({ event, status: DELIVERY_STATUS.SUPPRESSED, entityId, recipientRef, reason: 'mailer-not-configured' })
    return { status: DELIVERY_STATUS.SUPPRESSED }
  }

  const { subject, text } = template[langFromLocale(locale)](data)
  try {
    await sendTransactionalEmail({ to, subject, text })
    await recordDelivery({ event, status: DELIVERY_STATUS.SENT, entityId, recipientRef })
    return { status: DELIVERY_STATUS.SENT }
  } catch (error) {
    // Sanitized reason only — never a provider secret or endpoint.
    const reason = sanitizeEmailError(error?.message, { isProduction: process.env.NODE_ENV === 'production' })
    await recordDelivery({ event, status: DELIVERY_STATUS.FAILED, entityId, recipientRef, reason })
    return { status: DELIVERY_STATUS.FAILED }
  }
}
