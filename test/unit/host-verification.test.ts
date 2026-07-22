import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  VERIFICATION_TRUST_WEIGHT,
  hostTrustScore,
  hostVerificationState,
  isServerVerifiedHost,
  verificationTrustPoints,
} from '../../src/modules/host/hostVerificationModel'

// C5 — "Verified host" and the trust score must reflect only server-confirmed ID review.
//
// The regression these tests lock down: the host dashboard used to keep a purely client-side
// `hostDocumentsSent` boolean, flipped by a "Send documents to admin" button that sent nothing
// anywhere, and fed it +20 into the displayed trust score (plus +10 for merely *naming* files in a
// file picker, whose bytes were never uploaded). A host could raise their own trust score by
// clicking a button. Nothing below can be moved by client state — the only input is the
// `idDocumentStatus` the server returns, which only an admin can set to APPROVED after reviewing
// the real uploaded document (see test/api/verification-states.test.mjs for the server machine).

describe('C5 verification state — derived only from the server idDocumentStatus', () => {
  it('maps each server status to its state', () => {
    expect(hostVerificationState('APPROVED')).toBe('verified')
    expect(hostVerificationState('PENDING_REVIEW')).toBe('inReview')
    expect(hostVerificationState('REJECTED')).toBe('rejected')
  })

  it('treats a missing status as unverified, never as verified', () => {
    expect(hostVerificationState(null)).toBe('unverified')
    expect(hostVerificationState(undefined)).toBe('unverified')
  })

  it('only an exact APPROVED counts as verified', () => {
    expect(isServerVerifiedHost('APPROVED')).toBe(true)
    expect(isServerVerifiedHost('PENDING_REVIEW')).toBe(false)
    expect(isServerVerifiedHost('REJECTED')).toBe(false)
    expect(isServerVerifiedHost(null)).toBe(false)
    expect(isServerVerifiedHost(undefined)).toBe(false)
  })

  it('does not accept look-alike values as verified', () => {
    // Strict equality on the server enum, deliberately: no case-folding, no substring, no
    // truthiness. A value that is not literally the server's APPROVED must never show the badge.
    for (const bogus of ['approved', 'Approved', ' APPROVED', 'APPROVED_LATER', 'VERIFIED', 'true', '1', '']) {
      expect(isServerVerifiedHost(bogus as never)).toBe(false)
      expect(hostVerificationState(bogus as never)).toBe('unverified')
    }
  })
})

describe('C5 trust score — no client-side input can raise it', () => {
  const baseline = { listingApprovalScore: 0, requestConfirmationScore: 0 }

  it('awards verification points only for a server-confirmed APPROVED', () => {
    expect(verificationTrustPoints('APPROVED')).toBe(VERIFICATION_TRUST_WEIGHT)
    expect(verificationTrustPoints('PENDING_REVIEW')).toBe(0)
    expect(verificationTrustPoints('REJECTED')).toBe(0)
    expect(verificationTrustPoints(null)).toBe(0)
    expect(verificationTrustPoints(undefined)).toBe(0)
  })

  it('gives an unverified host zero verification credit', () => {
    expect(hostTrustScore({ ...baseline, idDocumentStatus: null })).toBe(0)
  })

  it('gives no credit for a submission that is still awaiting admin review', () => {
    // Submitting is a real server fact, but it is not verification. An in-review host scores
    // exactly the same as one who has submitted nothing at all.
    expect(hostTrustScore({ ...baseline, idDocumentStatus: 'PENDING_REVIEW' })).toBe(
      hostTrustScore({ ...baseline, idDocumentStatus: null }),
    )
  })

  it('gives no credit for a rejected submission', () => {
    expect(hostTrustScore({ ...baseline, idDocumentStatus: 'REJECTED' })).toBe(
      hostTrustScore({ ...baseline, idDocumentStatus: null }),
    )
  })

  it('adds the verification weight once the admin has approved', () => {
    expect(hostTrustScore({ ...baseline, idDocumentStatus: 'APPROVED' })).toBe(VERIFICATION_TRUST_WEIGHT)
  })

  it('weights server-owned listing and booking outcomes as before', () => {
    // 100 * 0.45 + 100 * 0.35 + 20 = 100 for a fully approved, fully confirmed, verified host.
    expect(hostTrustScore({
      listingApprovalScore: 100,
      requestConfirmationScore: 100,
      idDocumentStatus: 'APPROVED',
    })).toBe(100)

    // Same host without the admin approval loses exactly the verification weight.
    expect(hostTrustScore({
      listingApprovalScore: 100,
      requestConfirmationScore: 100,
      idDocumentStatus: null,
    })).toBe(80)
  })

  it('clamps to 0..100 for out-of-range inputs', () => {
    expect(hostTrustScore({ listingApprovalScore: 999, requestConfirmationScore: 999, idDocumentStatus: 'APPROVED' })).toBe(100)
    expect(hostTrustScore({ listingApprovalScore: -999, requestConfirmationScore: -999, idDocumentStatus: null })).toBe(0)
  })

  it('is a pure function of its declared inputs — there is no "documents sent" lever', () => {
    // Guards against reintroducing a client-settable term: two calls with identical server facts
    // must always agree, whatever the caller did in between.
    const input = { listingApprovalScore: 50, requestConfirmationScore: 50, idDocumentStatus: 'PENDING_REVIEW' as const }
    expect(hostTrustScore(input)).toBe(hostTrustScore(input))
    expect(Object.keys(input).sort()).toEqual(['idDocumentStatus', 'listingApprovalScore', 'requestConfirmationScore'])
  })
})

// Reintroduction guard. The model above can only be trusted if the dashboard actually uses it —
// a future edit re-adding a local "documents sent" boolean would leave every assertion above
// passing while the displayed score went back to being self-servable.
describe('C5 reintroduction guard — the host dashboard holds no local verification flag', () => {
  const dashboardSource = readFileSync(
    fileURLToPath(new URL('../../src/modules/host/HostDashboardPage.tsx', import.meta.url)),
    'utf8',
  )

  it('has no client-side "documents sent to admin" state', () => {
    expect(dashboardSource).not.toMatch(/hostDocumentsSent/)
    expect(dashboardSource).not.toMatch(/setHostDocumentsSent/)
  })

  it('claims documents were sent only in response to a real upload, never an onClick setter', () => {
    // The old code was `onClick={() => setHostDocumentsSent(true)}` — a state flip standing in for
    // a network call. No onClick anywhere in this file may set a verification/documents flag.
    expect(dashboardSource).not.toMatch(/onClick=\{\(\)\s*=>\s*set\w*(Documents|Verified|Trust)\w*\(/i)
  })

  it('computes the displayed trust score through the shared model, not inline arithmetic', () => {
    expect(dashboardSource).toMatch(/hostTrustScore\(/)
    // The old inline formula carried these literal weights; they now live only in the model.
    expect(dashboardSource).not.toMatch(/0\.45/)
    expect(dashboardSource).not.toMatch(/0\.35/)
  })

  it('derives the verified label from the server status via the shared model', () => {
    expect(dashboardSource).toMatch(/hostVerificationState\(/)
  })
})
