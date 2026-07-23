import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchApprovedListings, fetchPrototypeListing } from '../../src/shared/api/platformApi.ts'

// SYB-006 — on a provider (API) failure the app must NEVER substitute fabricated inventory. Before this
// change, fetchApprovedListings returned 14 hardcoded "SYBNB Verified Provider" listings on any error,
// and fetchPrototypeListing returned a fabricated listing detail. Both must now surface the failure so
// callers can show a truthful error state (distinct from a real empty result).

describe('SYB-006 — provider failure surfaces truthfully, never fabricated inventory', () => {
  let originalFetch

  beforeEach(() => { originalFetch = globalThis.fetch })
  afterEach(() => { globalThis.fetch = originalFetch })

  it('fetchApprovedListings rejects on a network failure rather than returning fabricated listings', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    await expect(fetchApprovedListings('STAYS')).rejects.toThrow()
  })

  it('fetchApprovedListings rejects on a non-OK API response rather than fabricating', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ ok: false, error: { message: 'boom' } }) }),
    )
    await expect(fetchApprovedListings('STAYS')).rejects.toThrow()
  })

  it('fetchApprovedListings returns the REAL empty set when the API responds with no listings', async () => {
    // Empty must be distinguishable from failed: a real empty response resolves to [], not fabrication.
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, listings: [] }) }),
    )
    await expect(fetchApprovedListings('STAYS')).resolves.toEqual([])
  })

  it('fetchApprovedListings passes real listings through unchanged', async () => {
    const real = [{ id: 'real-1', ownerId: 'owner-1', division: 'STAYS' }]
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, listings: real }) }),
    )
    await expect(fetchApprovedListings('STAYS')).resolves.toEqual(real)
  })

  it('fetchPrototypeListing rejects on failure rather than serving a fabricated listing detail', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network down')))
    await expect(fetchPrototypeListing('fallback-stay-malki-apartment')).rejects.toThrow()
  })
})
