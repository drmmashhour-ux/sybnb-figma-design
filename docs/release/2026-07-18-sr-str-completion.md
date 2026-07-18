# SYBNB V6 — Production Release: SR + STR Feature Completion

**Release date:** 2026-07-18
**Deployment:** https://sybnb.app (Vercel project `sybnb-figma-design`)
**Commit:** `da018b9`
**Release state:** DEPLOYED — inherits prior release records' verification status; SR/STR-specific
functional behavior is self-reported by the building session, not independently verified here.

```text
Deployment:                     completed
Production build:               clean (per building session's report)
Authenticated functional checks: not run by this session
```

## Relationship to prior release records

This repository (`sybnb-figma-design`) shares exact git history with the repository this
conversation used for the 2026-07-12 predeployment security work
(`SYBNB_STR_FINAL_UPDATED_FOR_CLAUDE_2026_07_05`, Vercel project `sybnb-v80-export`). Confirmed via
`git log`: this repo's history includes commits `b6fd5c1`, `69b30de`, and `35329ec` verbatim —
the same commits documented in
[`2026-07-12-referral-and-hardening.md`](./2026-07-12-referral-and-hardening.md) and
[`2026-07-12-landing-truthfulness-remediation.md`](./2026-07-12-landing-truthfulness-remediation.md).
Those two records remain accurate and are **not modified or superseded** by this document — they
describe what shipped in those commits, which are still present in this codebase's history.

This repository continued 15 additional commits past `35329ec` (marketplace, SR fleet,
consumer-protection engine, disputes/refunds, phone/SMS verification, and the SR+STR completion
below), built by a separate Claude Code session working directly in this repository. This document
records that additional work; it does not re-verify or re-review it beyond what's stated below.

## What shipped in this release (SR + STR completion)

Per the building session's own completion report:

- **SR ride pickup-code flow** — rider (`SrRidePage`) sees the 4-digit code once matched; driver
  confirms it via `POST /api/sr/rides/:id/verify-pin` to advance the ride to in-progress, with
  attempt-limit and mismatch error handling.
- **Driver vehicle registration** — add-vehicle form (make/model/year/plate/color/tier), approval
  status list, age-limit rejection surfaced.
- **Driver road-ready readiness panel** (new this release, commit `da018b9`) — a home-screen panel
  showing ID / licence+registration / approved-vehicle status and an overall "road-ready" gate,
  computed client-side from three existing endpoints (`GET /api/driver/rides` overview status,
  `GET /api/driver/documents`, `GET /api/driver/vehicles`) mirroring the server's
  `requireRoadReadyDriver` gate. No backend change was required for this piece.
- **Guest cancellation** — `/booking/:id` policy + confirm dialog (refund and withheld-fee cases)
  via `PATCH /api/bookings/:id/cancel`.
- **Disputes** — guest can open a dispute on a completed ride/booking and view "my disputes"
  (`POST /api/disputes`, `GET /api/disputes`); admin has an open-queue with refund/reject-with-note
  actions (`GET /api/admin/disputes`, `PATCH /api/admin/disputes/:id`).

All screens reported as AR/EN with RTL default, using real API calls with real loading/empty/error
states — no mock or placeholder data per the building session's report.

## Test suite (self-reported by the building session, not independently re-run here)

| Suite | Result |
| --- | --- |
| `test:api` | 257/257 |
| `test:security` | 19/19 |
| `test:unit` | 66/66 |

No frontend test harness exists in this repo; `tsc`/`vite build` clean per the building session.

## Production deployment (self-reported, spot-checked)

- Deployed commit `da018b9`, confirmed to match local `HEAD` at deploy time.
- `sybnb.app/api/health` → HTTP 200 at deploy time.
- Independently confirmed by this session: `sybnb.app` is currently aliased to this Vercel
  project's deployment (not `sybnb-v80-export`'s), and the domain is reachable.

## Domain/project authority (resolved this session)

Both `sybnb-v80-export` and `sybnb-figma-design` were found registered against the `sybnb.app`
custom domain simultaneously — the same class of domain conflict resolved once already in the
2026-07-12 predeployment work. Investigation this session (git log comparison, shared commit
hashes, CI workflow name "SYBNB V6 CI") confirmed `sybnb-figma-design` is the actively-developed,
more current V6 codebase, and the domain's actual live alias already pointed to it. No domain
change was made — the existing alias was left as-is once confirmed correct. `sybnb-v80-export`
should not be independently deployed to `sybnb.app` going forward without reconciling the two
repositories first, to avoid a repeat of this conflict.

## Explicitly NOT verified by this session

- The ~80 feature commits in this repository's history beyond `35329ec` (marketplace,
  SR fleet/cancellation/dispatch layers, consumer-protection engine, phone/SMS verification,
  compliance/account-deletion features, multi-country configuration) have **not** been
  security-reviewed in this conversation. They were built and tested by a separate session; this
  document records their existence and reported test results, not an independent audit.
- The authenticated manual verification checklist from the 2026-07-12 release record has not yet
  been run against this repository's current production deployment. That checklist (staff login,
  session revocation, referral flow, gift expiry, ID-verification gate, cancellation fee, legal
  pages, Admin Review real values, unauthorized access denial) should be re-run against the
  current live state, now that production includes the SR+STR additions on top of it.

## Final release state

Not yet certified. Per the same governance process established in the 2026-07-12 records: the
next required step is the owner personally completing the authenticated verification checklist
against the current live `sybnb.app` (now serving this repository's `da018b9`), reporting back
PASS/FAIL results and evidence — never the OTP — so a final release state can be recorded here.
