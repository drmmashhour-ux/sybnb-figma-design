// C5 — host identity verification, as a pure DOM-free model.
//
// This file exists to hold one rule in one place: nothing the client does can make a host look
// verified or raise their trust score. The only input is `idDocumentStatus` as returned by the
// server (GET /api/host/overview), which reaches 'APPROVED' only when an ADMIN approves a real
// uploaded document — see server/routes/me.mjs (submission) and server/routes/admin.mjs (decision).
//
// Previously the dashboard kept a local `hostDocumentsSent` boolean, flipped by a button that sent
// nothing anywhere, and added +20 to the displayed trust score from it (plus +10 for merely picking
// file names that were never uploaded). Both are gone; the identity term below is the replacement.

export type HostIdDocumentStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | null | undefined

export type HostVerificationState = 'verified' | 'inReview' | 'rejected' | 'unverified'

// Strict equality against the server enum, deliberately: no case-folding, no trimming, no
// truthiness. Anything that is not literally the server's value is treated as unverified, so a
// malformed or unexpected payload can only ever fail closed.
export function hostVerificationState(status: HostIdDocumentStatus): HostVerificationState {
  if (status === 'APPROVED') return 'verified'
  if (status === 'PENDING_REVIEW') return 'inReview'
  if (status === 'REJECTED') return 'rejected'
  return 'unverified'
}

export function isServerVerifiedHost(status: HostIdDocumentStatus): boolean {
  return hostVerificationState(status) === 'verified'
}

export const VERIFICATION_TRUST_WEIGHT = 20

// A submission awaiting review earns nothing. Submitting is a real fact, but it is not
// verification, and crediting it is what made the old score self-servable.
export function verificationTrustPoints(status: HostIdDocumentStatus): number {
  return isServerVerifiedHost(status) ? VERIFICATION_TRUST_WEIGHT : 0
}

export type HostTrustScoreInput = {
  /** Share of this host's listings an admin has approved, 0..100. */
  listingApprovalScore: number
  /** Share of this host's booking requests that reached CONFIRMED, 0..100. */
  requestConfirmationScore: number
  /** Verbatim `overview.host.idDocumentStatus` from the server. */
  idDocumentStatus: HostIdDocumentStatus
}

export function hostTrustScore({
  listingApprovalScore,
  requestConfirmationScore,
  idDocumentStatus,
}: HostTrustScoreInput): number {
  const raw = Math.round(
    listingApprovalScore * 0.45
    + requestConfirmationScore * 0.35
    + verificationTrustPoints(idDocumentStatus),
  )
  return Math.min(100, Math.max(0, raw))
}
