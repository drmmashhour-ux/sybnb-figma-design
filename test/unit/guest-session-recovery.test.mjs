import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// RC1 browser-E2E defect fix: a guest whose stored device-session token was rejected (401/403) was
// permanently stuck — ensurePrototypeGuestSession blindly reused the dead token, so booking and payment
// proof could never succeed again. The fix clears the stale session and retries once with a fresh one.
// This source-level guard (no jsdom runner) asserts the recovery wiring stays in place; the runtime
// behaviour was confirmed in the browser (POST /api/bookings 401 -> checkout-guest 200 -> 201).

const api = readFileSync(new URL('../../src/shared/api/platformApi.ts', import.meta.url), 'utf8')

describe('RC1 — guest session recovery on stale token', () => {
  it('ensurePrototypeGuestSession supports forcing a fresh session', () => {
    expect(api).toMatch(/async function ensurePrototypeGuestSession\(forceNew = false\)/)
  })

  it('has a withGuestSession wrapper that refreshes + retries once on an auth error', () => {
    expect(api).toMatch(/async function withGuestSession/)
    // On isAuthApiError it clears the session and re-establishes a fresh one before retrying.
    const block = api.slice(api.indexOf('async function withGuestSession'), api.indexOf('async function withGuestSession') + 500)
    expect(block).toMatch(/isAuthApiError/)
    expect(block).toMatch(/clearGuestSession\(\)/)
    expect(block).toMatch(/ensurePrototypeGuestSession\(true\)/)
  })

  it('the booking and payment-proof write paths use withGuestSession', () => {
    // createPrototypeBooking
    const book = api.slice(api.indexOf('export async function createPrototypeBooking'), api.indexOf('export async function createPrototypeBooking') + 600)
    expect(book).toMatch(/withGuestSession/)
    // submitPrototypeLocalWalletProof
    const proof = api.slice(api.indexOf('export async function submitPrototypeLocalWalletProof'), api.indexOf('export async function submitPrototypeLocalWalletProof') + 500)
    expect(proof).toMatch(/withGuestSession/)
  })
})
