# SYBNB — Storage Validation Wave 1 Plan

**Date:** 2026-07-22
**Type:** Plan only. **Not executed.** No Cloudflare connection, no object uploaded, no implementation or test change.
**Validates:** storage implementation frozen at `79a3bbb`, documented at `6b92b07`.
**Phase:** VALIDATION — not feature development. No architectural expansion authorized.

> **Why this exists.** The storage subsystem is complete, tested and documented, but its central claim
> — that uploaded bytes now survive instance replacement — **has never been tested against Cloudflare
> R2**. Configuration passed 12/12 redacted checks; no object has been written. Every test to date ran
> on the local filesystem driver, which cannot reproduce the defect being fixed. Wave 1 closes that gap.

---

## 0. A constraint that shapes the whole plan

**The existing test suite cannot perform this validation.** `server/lib/object-storage.mjs` refuses the
`s3` driver whenever `NODE_ENV=test`, at boot *and* at driver use, and `test/support/setup.env.mjs`
additionally pins the suite to a temp directory and deletes any `STORAGE_S3_*` values it finds. That
guard is deliberate and must not be weakened — it is what prevents a stray credential from letting the
suite write to a live bucket.

**Consequence:** Wave 1 runs as a **separate, explicitly-invoked harness**, outside the Vitest suites,
with `NODE_ENV` set to something other than `test`. Suggested shape: `scripts/validate-storage-r2.mjs`,
run manually, never wired into `npm test` or CI.

**Corollary — the local driver would produce a false pass.** Two processes on one machine share a disk,
so a cross-instance test on the `local` driver passes trivially while proving nothing. Wave 1 is only
meaningful with `STORAGE_DRIVER=s3` against the R2 test buckets.

**Data rule for every item below:** synthetic objects only. No real passports, government IDs, host or
guest documents, customer media, or production records. Test buckets only — `sybnb-test-media` and
`sybnb-test-documents`. Staging and production credentials are not injected and must not be.

---

## 1. Cross-instance R2 verification — the mandatory gate

**Claim under test:** an object written by one application instance is readable by a different instance
with no shared local state, and remains readable after a restart.

| # | Step | Expected |
|---|---|---|
| 1.1 | **Instance A** (process 1, `STORAGE_DRIVER=s3`) writes a synthetic object via `putObject` | Returns key; no error |
| 1.2 | Persist the returned key to the database through the normal governed path | Row written; key matches |
| 1.3 | **Terminate Instance A completely** | Process exits |
| 1.4 | **Instance B** (fresh process, no shared in-memory state) reads via `getObject` | Bytes returned, byte-identical to what A wrote |
| 1.5 | Restart and read again from a **third** process | Still readable |
| 1.6 | Confirm `server/uploads/` was not created or modified at any point during the run | Directory mtime unchanged; no new files |

**1.6 is the check that proves the fix.** Steps 1.1–1.5 would also pass on the local driver on one
machine; only the absence of local filesystem activity distinguishes real durability from a shared
disk.

**Metadata authority:** at each read, resolve the object **through the database record**, never from a
key held in memory by the test — this exercises the same path the application uses.

**Pass criteria:** bytes identical across all three processes; zero local filesystem writes; the
database reference remains the sole source of truth.

**Honest limit:** this simulates instance replacement with separate local processes. It does **not**
reproduce Vercel's actual cold-start and instance-recycling behaviour, which requires a deployed
environment. That is a Wave 2 item, not a Wave 1 one, and Wave 1 passing must not be represented as
production verification.

---

## 2. Multi-instance consistency

Each operation initiated on one instance and observed from another.

| # | Scenario | Expected |
|---|---|---|
| 2.1 | Upload on A → retrieve on B | Success, bytes identical |
| 2.2 | Upload on A → delete on B → read on A | Truthful not-found, not an empty success |
| 2.3 | Upload on A → metadata lookup on B | Governed record resolves; key matches |
| 2.4 | Authorization decision made on B for an object written by A | Same verdict as A would give |
| 2.5 | Media key from listing X requested against listing Y, from a different instance | Refused — the row-binding check holds across instances |
| 2.6 | Private document read by owner on B, by non-owner on A | Owner allowed, non-owner refused |
| 2.7 | Concurrent uploads from A and B to the same listing | Distinct keys, both rows persist, no overwrite |
| 2.8 | Replacement on A, read on B | B sees the new object; the superseded key no longer resolves |

**Pass criteria:** no operation's outcome depends on which instance served it. Authorization verdicts
are identical across instances — they derive from the database, not from instance state.

---

## 3. Failure testing

Failures induced by configuration and process control, **not** by attacking Cloudflare.

| # | Scenario | Induced by | Expected |
|---|---|---|---|
| 3.1 | **R2 unreachable** | Point `STORAGE_S3_ENDPOINT` at an unroutable host | `STORAGE_UNAVAILABLE` (503). No false success. **No endpoint, bucket, account ID or credential in the response** |
| 3.2 | **Invalid credentials** | Corrupt the secret key in the harness environment | Truthful auth failure; no credential echoed into any message or log |
| 3.3 | **Network interruption mid-upload** | Kill the process during `putObject` | No database row created. Any partial object is an orphan, never a dangling reference |
| 3.4 | **Metadata failure after object write** | Force the database write to fail (constraint violation or disconnect) | Object deleted by the cleanup path; error propagated; **no success returned** |
| 3.5 | **Orphan detection** | After 3.3 and 3.4, enumerate test-bucket objects with no matching row | Count and record. **Do not build reconciliation** — STG-14 remains open; this measures the real orphan rate at known volume |
| 3.6 | **Object missing, reference present** | Delete the object out-of-band, keep the row | Truthful failure. Never an empty 200 |
| 3.7 | **Retry behaviour** | Repeat a failed upload | Fresh UUID key each attempt; no overwrite; no duplicate row |
| 3.8 | **Fail-closed authorization under storage failure** | Combine 3.1 with an unauthorized request | Authorization refuses **before** any storage call is attempted — a storage outage must not become an access-control bypass |
| 3.9 | **Deletion failure** | Make delete fail while the row update succeeds | Request still succeeds; orphan recorded; no dangling reference |

**3.8 is the most important item in this section.** Everything else is availability; 3.8 is
confidentiality.

**Pass criteria:** every failure mode produces a truthful, non-leaking error; no false success anywhere;
no dangling database reference under any induced failure.

---

## 4. Security validation

| # | Check | Method | Expected |
|---|---|---|---|
| 4.1 | **Buckets are private** | Unauthenticated request directly to the R2 endpoint for a known-existing object key | Refused. **This is the highest-value check in Wave 1** — it is the only direct proof that STG-05 has not occurred |
| 4.2 | No public development URL | Confirm `r2.dev` disabled on both test buckets | Disabled |
| 4.3 | No custom domain | Dashboard confirmation | None |
| 4.4 | No signed URLs | `getSignedUrl` absent from source; no route returns a storage URL | 0 occurrences |
| 4.5 | No bucket CORS | Bucket configuration inspection | No policy |
| 4.6 | No browser credentials | Grep the production build output for every storage variable name and value | 0 occurrences |
| 4.7 | No secret exposure in errors | Trigger every error path from §3; scan responses and logs | No endpoint, bucket, account ID, key ID, secret, provider error, or filesystem path |
| 4.8 | Authorization enforced | Unauthenticated, wrong-owner, wrong-role, and raw-key access attempts against both paths | All refused; refusal precedes any storage call |
| 4.9 | Forced download preserved | Private document retrieval | `Content-Disposition: attachment`, sanitised filename, `private, no-store`, `nosniff` |
| 4.10 | Staff audit emitted | Staff document read | `STAFF_DOCUMENT_ACCESSED` recorded; contains no bytes, key, bucket, or credential |
| 4.11 | Test isolation holds | Attempt an `s3` operation with `NODE_ENV=test` | Refused — confirms the guard survives the harness's existence |

**4.11 matters because Wave 1 introduces the first legitimate reason to run `s3` outside production.**
The harness must not become a way to weaken the test guard.

---

## 5. Performance validation — measure, do not optimize

Baselines only. No tuning, no caching, no CDN, no signed URLs.

| # | Measure | Method | Purpose |
|---|---|---|---|
| 5.1 | Upload latency | p50/p95 over ~50 synthetic uploads at 100 KB, 1 MB, 8 MB | Establish the write baseline |
| 5.2 | Download latency | Same distribution, through the proxy route | Captures the full `user → runtime → R2 → runtime` path, which is what users experience |
| 5.3 | Metadata latency | Database resolution time alone | Separates database cost from storage cost — decides whether D-1/D-6 region choices matter more for one than the other |
| 5.4 | Object-size handling | 1 KB, 100 KB, 1 MB, 8 MB, and 8 MB + 1 byte | Confirms the ceiling rejects cleanly rather than timing out |
| 5.5 | Concurrency | 10 and 25 simultaneous uploads and downloads | Reveals proxy saturation behaviour under the serverless model |
| 5.6 | Proxy overhead | Compare direct R2 timing against the proxied route | Quantifies the accepted cost of the ADR-0010 proxy decision |

**Record the harness's own network position** — latency measured from a developer machine is not
production latency and must be labelled as such.

**Pass criteria:** none. This section produces numbers, not verdicts. Its output feeds D-1 and D-6.

---

## 6. Production readiness gates

### Gate A — Internal Testing

| Gate | Source |
|---|---|
| §1 cross-instance verification passes, including 1.6 (no local filesystem dependency) | Wave 1 |
| §2 multi-instance consistency passes in full | Wave 1 |
| §3 failure testing passes, especially 3.4 and 3.8 | Wave 1 |
| §4 security validation passes, especially 4.1 | Wave 1 |
| §5 baselines recorded | Wave 1 |
| Full existing suite still green (301 unit / 462 API / 21 security) | Existing |

**Gate A is what Wave 1 delivers.**

### Gate B — Closed Beta

Everything in Gate A, plus:

| Gate | Status |
|---|---|
| **D-6** Neon region decided (irreversible) and **D-1** Vercel region decided | Open |
| Staging environment provisioned; staging buckets and credentials injected | Open |
| Same-shape verification repeated **on staging** — upload, redeploy, still readable | Open |
| **Observability** — error aggregation and the storage signals in STG-22 | Open |
| **Backup and restore rehearsed**, not merely documented | Open |
| Credential rotation exercised once | Open |
| **D-7** decided before real identity documents are replaced | Open |
| **C4** availability enforcement, **H3** host payout configuration | Open |
| Division isolation; fabricated-fallback removal | Open |
| Beta participant agreement; support channel and hours | Open |

### Gate C — Production

Everything in Gate B, plus:

| Gate | Status |
|---|---|
| **EV-01…EV-07** resolved with external evidence — provider eligibility, sanctions, privacy regime, Canadian obligations, EU-storage obligations, cross-border admin access | All OPEN |
| Production buckets and credentials provisioned; boot-failure behaviour confirmed | Open |
| Post-deploy verification: upload → **redeploy** → still retrievable | Open |
| Direct unauthenticated request to a production object refused | Open |
| **STG-11** decision — accept, or implement scanning | Open |
| **STG-14** orphan reconciliation, informed by the §3.5 measurement | Open |
| Media-route rate limiting; `DOCUMENT_ACCESS` fail-open reconsidered | Open |
| Registered legal entity on the legal pages (B1) | Open |
| Incident response documented; rollback rehearsed | Open |
| Ride and Quebec storage migrated **or** formally accepted as out of scope while frozen | Open |

**No gate in Gate C is currently satisfied. Production remains unapproved.**

---

## 7. What Wave 1 cannot establish

Stated so that a passing Wave 1 is not over-read:

- **Production behaviour.** Local processes are not Vercel instances; real cold starts and recycling need a deployment.
- **Backup and restore.** Nothing here rehearses recovery.
- **Monitoring.** Wave 1 observes manually; it does not create alerting.
- **Content safety.** Signature validation is unchanged; STG-11 is untouched.
- **Retention correctness.** D-7 is undecided; Wave 1 must not exercise retention behaviour.
- **Ride and Quebec.** Both remain on local disk and outside this plan entirely.
- **Real-user load.** Concurrency figures come from a synthetic harness.

---

## 8. Execution prerequisites

Before Wave 1 runs, the owner must confirm:

1. Authorization to **connect to R2 and write synthetic objects** to the two test buckets — Wave 1 is the first work in this programme that touches Cloudflare at all.
2. Whether the harness may be added to `scripts/` (a new file), or must live entirely outside the repository.
3. That test-bucket objects created during validation may be left in place or should be cleaned up afterwards.
4. Acceptance that induced-failure testing (§3) will briefly point configuration at invalid endpoints and credentials — no production or staging value is involved.

**None of this is authorized by this document.** The plan is written; execution is a separate decision.
