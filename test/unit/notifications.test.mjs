import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// SYB-003 — transactional notification subsystem. The mailer is mocked so we can exercise SENT/FAILED
// deterministically; the DB audit write is swallowed by design (never breaks the workflow), so these
// pure-logic tests run in the node unit suite.

const mailer = { isMailerConfigured: vi.fn(), sendTransactionalEmail: vi.fn(), sanitizeEmailError: (m) => `sanitized:${m || ''}` }
vi.mock('../../server/lib/mailer.mjs', () => mailer)

const { notify, DELIVERY_STATUS, TRANSACTIONAL_EVENTS } = await import('../../server/lib/notifications.mjs')

describe('SYB-003 — delivery status matrix', () => {
  beforeEach(() => { mailer.isMailerConfigured.mockReset(); mailer.sendTransactionalEmail.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('NO_CHANNEL when the recipient has no email (anonymous guest)', async () => {
    mailer.isMailerConfigured.mockReturnValue(true)
    const r = await notify({ event: 'PAYMENT_HOLD_EXPIRED', to: null, data: { ref: 'ABC' } })
    expect(r.status).toBe(DELIVERY_STATUS.NO_CHANNEL)
    expect(mailer.sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it('SUPPRESSED when the mailer is not configured (dev/test)', async () => {
    mailer.isMailerConfigured.mockReturnValue(false)
    const r = await notify({ event: 'PAYMENT_HOLD_EXPIRED', to: 'guest@example.test', data: { ref: 'ABC' } })
    expect(r.status).toBe(DELIVERY_STATUS.SUPPRESSED)
    expect(mailer.sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it('SUPPRESSED for an unknown event', async () => {
    mailer.isMailerConfigured.mockReturnValue(true)
    const r = await notify({ event: 'NOT_A_REAL_EVENT', to: 'x@example.test' })
    expect(r.status).toBe(DELIVERY_STATUS.SUPPRESSED)
  })

  it('SENT when the mailer is configured and delivery succeeds', async () => {
    mailer.isMailerConfigured.mockReturnValue(true)
    mailer.sendTransactionalEmail.mockResolvedValue({ id: 'msg-1' })
    const r = await notify({ event: 'BOOKING_CONFIRMED', to: 'guest@example.test', locale: 'en-US', data: { ref: 'BK-1' } })
    expect(r.status).toBe(DELIVERY_STATUS.SENT)
    expect(mailer.sendTransactionalEmail).toHaveBeenCalledOnce()
    const arg = mailer.sendTransactionalEmail.mock.calls[0][0]
    expect(arg.to).toBe('guest@example.test')
    expect(arg.subject).toMatch(/confirmed/i)
    expect(arg.text).toContain('BK-1')
  })

  it('FAILED (never throws) when the mailer errors mid-send', async () => {
    mailer.isMailerConfigured.mockReturnValue(true)
    mailer.sendTransactionalEmail.mockRejectedValue(new Error('smtp exploded at 10.0.0.1'))
    let threw = false
    let result
    try { result = await notify({ event: 'PAYMENT_APPROVED', to: 'g@example.test', data: { ref: 'BK-2' } }) } catch { threw = true }
    expect(threw).toBe(false) // notification failure must never propagate
    expect(result.status).toBe(DELIVERY_STATUS.FAILED)
  })

  it('localizes by locale — Arabic for ar-*, English otherwise', async () => {
    mailer.isMailerConfigured.mockReturnValue(true)
    mailer.sendTransactionalEmail.mockResolvedValue({})
    await notify({ event: 'BOOKING_CONFIRMED', to: 'a@example.test', locale: 'ar-SY', data: { ref: 'BK-3' } })
    const ar = mailer.sendTransactionalEmail.mock.calls[0][0]
    expect(ar.subject).toMatch(/تأكيد/)
    mailer.sendTransactionalEmail.mockClear()
    await notify({ event: 'BOOKING_CONFIRMED', to: 'a@example.test', locale: 'en', data: { ref: 'BK-3' } })
    expect(mailer.sendTransactionalEmail.mock.calls[0][0].subject).toMatch(/confirmed/i)
  })
})

describe('SYB-003 — event catalogue', () => {
  it('every approved event has an Arabic and English template', () => {
    const expected = [
      'BOOKING_SUBMITTED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'PAYMENT_PROOF_RECEIVED',
      'PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'PAYMENT_HOLD_EXPIRED', 'PAYOUT_INITIATED',
      'PAYOUT_COMPLETED', 'ACCOUNT_ACTION',
    ]
    for (const e of expected) {
      expect(TRANSACTIONAL_EVENTS[e], `${e} missing`).toBeTruthy()
      expect(typeof TRANSACTIONAL_EVENTS[e].ar).toBe('function')
      expect(typeof TRANSACTIONAL_EVENTS[e].en).toBe('function')
    }
  })
})
