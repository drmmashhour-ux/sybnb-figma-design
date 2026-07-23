# SYBNB — Persistent Object Storage Implementation Plan (PROPOSAL — not implemented)

**Date:** 2026-07-22
**Status:** Planning only. **No code has been changed.** Awaiting owner decisions in §12.
**Priority:** P0 position 1 — blocks the STR closed beta.
**Companion documents:** `SYBNB_FULL_PLATFORM_LAUNCH_READINESS_REVIEW.md`, `SYBNB_STR_CLOSED_BETA_BOUNDARY.md`

---

## 1. Problem statement

All six upload subsystems write to the local filesystem under `server/uploads/`, while the deployment
target is Vercel serverless (`vercel.json` → `api/index.mjs`). That filesystem is ephemeral and
per-instance. In production this means:

- A photo uploaded by a host is written to instance A. The guest's image request lands on instance B → **404**.
- An identity document uploaded during verification is gone after the next cold start → **the admin has nothing to review, and an already-APPROVED user's document cannot be re-examined**.
- A deployment replaces all instances → **every previously uploaded file is unreachable**.

`server/lib/env.mjs` validates secrets, database, CORS, Redis and mail, but has **no concept of object
storage**. Production therefore boots cleanly and then loses data silently.

**Two consequences worth stating plainly:** roadmap **C2 is marked COMPLETE** but is non-functional in
production, and the **C5** verification chain completed on 2026-07-22 depends entirely on documents that
will not survive.

---

## 2. What is already correct (and must be preserved)

This is not a rewrite. The existing design is good and only its *byte destination* is wrong.

| Existing property | Evidence | Keep? |
|---|---|---|
| Storage keys are `randomUUID()` + extension — never the original filename, never a listing/user id | `listing-media-storage.mjs:60`, all six modules | **Yes** — already satisfies "avoid original filenames as object identity" |
| Six modules share one interface: `save*(base64, mime)`, `read*(key)`, `delete*(key)` | all six modules | **Yes** — makes a single abstraction straightforward |
| MIME allowlist per subsystem | e.g. `ALLOWED_LISTING_MEDIA_TYPES` | **Yes** — extend, don't replace |
| 8 MB ceiling on every subsystem | `MAX_*_BYTES` | **Yes** |
| Key-shape re-validation before any filesystem access (path-traversal guard) | `isValidListingMediaKey`, `listing-media-storage.mjs:66-74` | **Yes** — becomes object-key safety |
| **Files are never served directly — always through an authz-gated route** | `listings.mjs:446-459`, `me.mjs:181`, `admin.mjs:368` | **Yes — this is the single most important property** |
| Key is bound to its owning row before serving | `listings.mjs:458-459` | **Yes** |
| Public/private distinction already enforced in the route (public once APPROVED, owner/admin while draft) | `listings.mjs:444-445` | **Yes** |

Because reads already go through an application route, **the object store never needs to be public**.
This is the lowest-risk migration available: swap the byte source inside six modules and change nothing
about how authorization works.

---

## 3. Exact scope — files, routes, modules, database

### 3.1 Storage modules to be re-pointed (6)

| Module | Local dir today | Data class |
|---|---|---|
| `server/lib/listing-media-storage.mjs` | `server/uploads/listing-media` | Listing / accommodation / room-type photos — **public after approval** |
| `server/lib/id-document-storage.mjs` | `server/uploads/id-documents` | Identity documents — **private, sensitive** |
| `server/lib/listing-document-storage.mjs` | `server/uploads/listing-documents` | Listing certificates (CITQ etc.) — **private** |
| `server/lib/thread-document-storage.mjs` | `server/uploads/thread-documents` | Message-thread attachments — **private to participants + staff** |
| `server/lib/driver-document-storage.mjs` | `server/uploads/driver-documents` | Driver licence / registration — **private** (SR — out of STR beta scope but must not break) |
| `server/lib/quebec-document-storage.mjs` | `server/uploads/quebec-documents` | Quebec onboarding docs — **private** (frozen context) |

### 3.2 Upload routes (write path)

| Route file | Endpoint | Calls |
|---|---|---|
| `server/routes/listings.mjs` | `POST /api/listings/:id/media` | `saveListingMedia` |
| `server/routes/listings.mjs` | `POST /api/listings/:id/documents` | `saveListingDocument` |
| `server/routes/me.mjs` | `PATCH /api/me/id-document` | `saveIdDocument` |
| `server/routes/admin.mjs` | `POST /api/admin/id-document/:userId/upload` | `saveIdDocument` |
| `server/routes/messages.mjs` | thread document upload | `saveThreadDocument` |
| `server/routes/driver.mjs` | driver document upload | `saveDriverDocument` |
| `server/routes/quebec-driver-onboarding.mjs` | 2 upload endpoints | `saveQuebecDocument` |

### 3.3 Serve routes (read path)

`listings.mjs` (`/media/file/:key`, listing documents), `me.mjs` (`/api/me/id-document/file`),
`admin.mjs` (`/api/admin/id-document/:userId/file`, driver documents, listing documents),
`driver.mjs`, `messages.mjs`, `quebec-driver-onboarding.mjs` (×2).

**No serve route changes its authorization logic.** Only the byte-fetch line changes.

### 3.4 Database references (no schema change proposed)

| Model.field | Line | Holds |
|---|---|---|
| `User.idDocumentRef` | `schema.prisma:142` | raw storage key |
| `ListingMedia.url` | `:658` | **serve path**, not the raw key — `/api/listings/:id/media/file/<key>` |
| `ListingDocument.assetUrl` | `:1522` | raw storage key |
| `DriverDocument.assetUrl` | `:911` | raw storage key |
| `ThreadDocument.assetUrl` | `:1590` | raw storage key |
| `QuebecDriverDocument.assetUrl` / `QuebecVehicleDocument.assetUrl` | `:501`, `:542` | raw storage key |
| `PaymentProof.proofAssetUrl` | `:794` | **not an upload** — a `stripe://` reference or client-supplied string |

Because the key format (`<uuid>.<ext>`) is unchanged, **existing rows remain valid references** and no
migration of database values is required.

---

## 4. Proposed architecture

### 4.1 One governed storage service

Introduce `server/lib/object-storage.mjs` exposing a driver-based interface:

- `putObject({ bucketClass, key, body, contentType })`
- `getObject({ bucketClass, key }) → Buffer`
- `deleteObject({ bucketClass, key })`
- `objectExists({ bucketClass, key })`

Two drivers behind one interface:
- **`s3` driver** — S3-compatible (R2), used in staging and production.
- **`local` driver** — the current filesystem behaviour, used only in local development and automated tests.

Driver selection by explicit env var, **not** by inference. `validateProductionConfig()` must reject the
`local` driver when `NODE_ENV=production`, so a misconfigured deployment refuses to boot rather than
silently losing files — the same fail-closed pattern already used for Redis.

The six existing modules keep their names, signatures, validation and error codes, and delegate their
three I/O lines to this service. **Route code does not change.**

### 4.2 Bucket classes and environment separation

Two logical bucket classes, because they have genuinely different access rules:

| Class | Contents | Access |
|---|---|---|
| `media` | listing / accommodation / room-type photos | Private in the store; served publicly **only** through the existing authz route after approval |
| `documents` | identity, listing, thread, driver, Quebec documents | Private; served only through authz routes to owner/staff |

Environment separation by **separate buckets, not shared buckets with prefixes** — a prefix mistake in
code would cross environments, a wrong bucket name fails loudly:

| Environment | media bucket | documents bucket |
|---|---|---|
| local dev | *(local driver — filesystem)* | *(local driver)* |
| automated test | *(local driver, temp dir)* | *(local driver, temp dir)* |
| staging | `sybnb-staging-media` | `sybnb-staging-documents` |
| production | `sybnb-prod-media` | `sybnb-prod-documents` |

**No production bucket may be referenced by local or test configuration.** Tests must be unable to reach
production even if credentials leak into the environment — enforced by a guard modelled on the existing
`server/lib/test-db-guard.mjs`, which already does exactly this for the database.

### 4.3 Object key structure

Keep the existing random identity, add a class prefix for operability (lifecycle rules, audits, targeted
deletion):

```
media/listing/<uuid>.<ext>
documents/id/<uuid>.<ext>
documents/listing/<uuid>.<ext>
documents/thread/<uuid>.<ext>
documents/driver/<uuid>.<ext>
documents/quebec/<uuid>.<ext>
```

**Compatibility requirement:** the value stored in the database stays the bare `<uuid>.<ext>` key exactly
as today; the prefix is applied inside the storage service. This keeps every existing DB row valid and
avoids a data migration. Original filenames are never used in the key, and never trusted.

### 4.4 Access model

**Recommendation: keep the authz-gated proxy for both classes; make no object publicly readable.**

- **Private documents** — proxy only. No signed URLs, no public access, credentials confined to the server.
  This preserves the current per-request ownership checks exactly.
- **Public listing photos** — proxy initially. It already works, it is already correctly gated on
  `APPROVED`, and it keeps the bucket fully private.

The trade-off to state honestly: proxying photos means image bytes flow through the serverless function,
costing invocation time and losing CDN caching. For a closed beta that is the right call — correctness and
simplicity over throughput. If photo delivery later becomes a performance problem, the upgrade path is
short-lived signed URLs (5–15 min) or a CDN in front of the media bucket, and it can be introduced without
touching the write path. **This is owner decision D2.**

---

## 5. Upload lifecycle — required behaviour

| Stage | Required behaviour |
|---|---|
| Upload started | Validate authorization, ownership, declared MIME, decoded size **before** any object write |
| Upload completed | Object written and confirmed before any database row is created or updated |
| Metadata persisted | DB row written **after** a successful object write. On DB failure → delete the orphaned object, return an error |
| Upload failure | No DB row, no partial object. Existing error codes preserved (`LISTING_MEDIA_TOO_LARGE`, `ID_DOCUMENT_REQUIRED`, …) |
| Abandoned upload | Object written but request aborted before DB commit → orphan. Mitigated by write-object-then-commit ordering plus a periodic orphan sweep (**deferred, not in this scope — see §11**) |
| Replacement | Write new object → update row → delete the old object, in that order. This is already the pattern in `me.mjs:157-176` and must be preserved |
| Deletion | Delete row (or clear reference) → delete object. A failed object delete must not fail the request; it becomes an orphan, never a dangling reference |
| Access denied | 403/404 per existing route logic, **before** any object read |
| Unsupported file | 400 with the existing per-subsystem code |
| Size limit | 400 at 8 MB, enforced on the decoded buffer |
| Interrupted request | No DB row; any written object becomes an orphan, never a broken reference |

**Ordering rule:** object first, database second, cleanup third. An orphaned object costs storage; a
dangling database reference is a broken product surface shown to a user.

---

## 6. Security controls

| Control | Today | Required change |
|---|---|---|
| MIME allowlist | Present | Keep |
| Extension derived from allowlist (never from filename) | Present | Keep |
| Size limit (8 MB, decoded) | Present | Keep |
| Authorization + ownership before read | Present in routes | Keep unchanged |
| Object-key safety (path traversal / tampering) | Regex re-validation before I/O | Keep; extend to reject any key containing `/`, `..`, or a prefix supplied by a caller |
| Private/public classification | Implicit in route logic | Make explicit via `bucketClass` |
| Malicious filename handling | Filenames never used in keys | Keep; also never echo a raw filename into a `Content-Disposition` header without sanitising |
| **Magic-byte content sniffing** | **Absent — MIME is taken from the request body** | **ADD.** Verify the decoded buffer's signature matches the declared type (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`, PDF `%PDF`) and reject on mismatch. This is the owner's explicit requirement not to rely on browser-provided MIME |
| Bucket credentials | n/a | Server-side only. Never sent to the client, never in a URL, never in `VITE_*` |
| Content-Type on serve | Derived from key extension (`mimeForKey`) | Keep — derived, not caller-supplied |
| `X-Content-Type-Options: nosniff` on file responses | Global header present | Verify it applies to file-serve responses specifically |

---

## 7. Test plan (test-first — written and failing before implementation)

**No storage tests exist today** — confirmed: nothing under `test/` references any storage module. All of
the following are new.

### 7.1 Unit — `test/unit/object-storage.test.ts` (no DB, no network)
1. Driver selection is explicit; unknown driver value throws.
2. `local` driver rejected when `NODE_ENV=production` (mirrors the Redis fail-closed rule).
3. Object-key safety: keys containing `/`, `..`, absolute paths, or null bytes are rejected.
4. Key generation is a v4 UUID plus an allowlist-derived extension; the original filename never appears.
5. Bucket-class resolution maps each subsystem to the correct class.
6. **Magic-byte sniffing:** a PNG signature declared as `application/pdf` is rejected; each allowed type accepts its true signature.
7. Size limit enforced on the decoded buffer, not the base64 string.
8. Test environment can never resolve to a production bucket name (guard test).

### 7.2 API — `test/api/object-storage-persistence.test.mjs` (DB-backed)
9. Listing media upload persists a durable reference; `ListingMedia.url` holds the serve path.
10. ID document upload persists `idDocumentRef`; the object is retrievable through the storage service.
11. **Durability contract:** after uploading, a *new storage service instance* (simulating a fresh serverless instance with no local state) can still read the object. **This is the test that would have caught the current defect.**
12. Failed DB write after a successful object write leaves no orphaned reference.
13. Replacement deletes the previous object and updates the reference.
14. Unsupported MIME rejected with the existing error code.
15. Oversized file rejected with the existing error code.
16. Unauthorized upload rejected before any object write.
17. Unauthorized private-document access returns 403/404 and reads no bytes.
18. Public media served only after `APPROVED`; draft media owner/admin-only (regression guard on existing behaviour).
19. Cross-listing key access rejected (key bound to its row).

### 7.3 Regression
20. The full existing suite (246 unit / 428 API / 21 security) must pass unchanged. Any storage-touching test that starts failing indicates a behaviour change that was supposed to be invisible.

---

## 8. Environment variables

New (none exist today — confirmed absent from `.env.example` and `.env.production.example`):

| Variable | Scope | Notes |
|---|---|---|
| `STORAGE_DRIVER` | all | `local` \| `s3`. **Explicit**, no inference. Production must be `s3` |
| `STORAGE_S3_ENDPOINT` | staging/prod | R2 S3-compatible endpoint |
| `STORAGE_S3_REGION` | staging/prod | `auto` for R2 |
| `STORAGE_S3_ACCESS_KEY_ID` | staging/prod | **Secret** — server only |
| `STORAGE_S3_SECRET_ACCESS_KEY` | staging/prod | **Secret** — server only |
| `STORAGE_BUCKET_MEDIA` | staging/prod | e.g. `sybnb-prod-media` |
| `STORAGE_BUCKET_DOCUMENTS` | staging/prod | e.g. `sybnb-prod-documents` |
| `STORAGE_LOCAL_DIR` | dev/test | Defaults to today's `server/uploads` |

`validateProductionConfig()` additions: require `STORAGE_DRIVER=s3`; require endpoint, both credentials
and both bucket names; **reject any bucket name containing `test`, `dev`, or `local`** while
`NODE_ENV=production`. No `VITE_`-prefixed storage variable may ever exist — that would ship credentials
to the browser.

---

## 9. Production-like verification

A local-disk test is explicitly insufficient. Required before the storage item is called complete:

1. **Against a real S3-compatible bucket** (R2 staging, or a controlled MinIO instance) — not the local driver.
2. **Cross-instance durability:** upload through one process, terminate it, read through a second process with no shared local state. This is the direct analogue of serverless instance replacement.
3. **Post-deployment survival:** upload to staging, redeploy, confirm the object is still retrievable.
4. **Authorization preserved on the real backend:** private document unreachable without a session; draft media unreachable by a non-owner; approved media publicly reachable.
5. **Manual browser verification, AR and EN:** host uploads a photo → appears on the listing; host uploads an ID → admin sees and opens it. Both after a redeploy.
6. **Negative cases against the real backend:** oversized, wrong-MIME, mismatched magic bytes, tampered key.

---

## 10. Rollback strategy

- **Mechanism:** `STORAGE_DRIVER` is the switch. Reverting to `local` restores previous behaviour instantly — but note that this restores the *defect*, so it is an emergency measure only.
- **Code rollback:** the six modules keep their signatures, so a code revert is clean and does not require a database change.
- **No database migration** is proposed, so there is nothing to reverse in Postgres.
- **Objects written during a rolled-back release remain in the bucket** and stay valid — keys and DB values are unchanged, so a re-deploy re-attaches them. Nothing is destroyed by a rollback.
- **Rollback trigger:** any failure in §9 items 2, 3 or 4.
- **Not covered:** files uploaded to the *local* driver during a period when production was misconfigured would be lost at instance replacement. That is the current state and is the reason for the fail-closed boot check.

---

## 11. Migration implications

**Current local files: 2,791 files, 11 MB**, across six directories:

| Directory | Files | Size |
|---|---|---|
| `listing-media` | 1,301 | 5.1 MB |
| `id-documents` | 787 | 3.1 MB |
| `quebec-documents` | 254 | 1.0 MB |
| `thread-documents` | 258 | 1.0 MB |
| `listing-documents` | 104 | 416 KB |
| `driver-documents` | 87 | 348 KB |

**Assessment:** `server/uploads/` is gitignored and **zero files are tracked in git**. No production
deployment currently exists. The volume and distribution (787 identity documents) are consistent with
accumulated local development and repeated automated-test runs, not real user data. **On the evidence,
migration is most likely unnecessary.**

That said — per the owner's instruction — **nothing will be deleted and no migration will run**. This is
recorded as owner decision **D4**, and if a migration is approved it will be a separate plan with its own
verification.

**Not in scope for this item:** the orphaned-object sweep (§5) and any lifecycle/retention rules in the
bucket. `listing-document-retention.mjs` already implements retention at the database level; aligning
object lifecycle with it is a follow-up.

---

## 12. Unresolved owner decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Object-storage provider | **(a) Cloudflare R2** · (b) AWS S3 · (c) Vercel Blob · (d) other S3-compatible | **(a) R2** — matches the stated preference, S3-compatible (portable), no egress fees (material when proxying images), works from Vercel. Vercel Blob is the tightest integration but is the least portable |
| **D2** | Public-media delivery | **(a) Proxy through the existing authz route** · (b) short-lived signed URLs · (c) public bucket + CDN | **(a)** for the closed beta — smallest change, bucket stays fully private, existing authorization preserved. Revisit if image latency becomes a real problem |
| **D3** | Private-document access | **(a) Proxy only, no signed URLs** · (b) short-lived signed URLs | **(a)** — identity documents should never have a URL that works outside an authenticated request, even briefly |
| **D4** | Existing local-file migration | **(a) Do not migrate — treat as dev/test residue, leave in place** · (b) migrate all · (c) migrate selectively after audit | **(a)**, on the evidence in §11. Nothing is deleted either way. If any of these files are real, choose (c) and a separate audit runs first |
| **D5** | Staging environment | (a) Create staging now · (b) verify against a controlled MinIO instance | **(a)** — §9 items 3 and 5 need a real deploy; a staging environment is needed for the closed beta regardless |
| **D6** | Magic-byte sniffing scope | **(a) All six subsystems** · (b) documents only | **(a)** — the cost is a few bytes of comparison per upload |
| **D7** | SR/Quebec storage modules | **(a) Migrate all six together** · (b) migrate only STR-relevant four | **(a)** — the modules are identical in shape; excluding two creates two competing patterns and leaves a known defect in place for later |
| **D8** | C5 commit ordering | (a) Commit C5 first · (b) after storage · (c) together | **(a)** — C5 is complete, tested and verified; leaving it uncommitted risks losing it and complicates every subsequent diff. It does not depend on storage, though it is not *effective* in production until storage lands |

---

## 14. Application runtime region — implementation consideration (owner decision required)

**Added 2026-07-22 following the EU-jurisdiction decision. No Vercel configuration has been changed, and
none will be without explicit owner approval.**

### Why this matters

The approved architecture proxies every byte in both directions:

```
user → application runtime → R2 → application runtime → user
```

Image bytes traverse **both** legs, so total latency is `user↔runtime` **plus** `runtime↔R2`. Choosing an
EU-jurisdiction store while the runtime executes in North America leaves the dominant leg unimproved — the
residency decision and the region decision only pay off together.

### Current state

**No region is configured.** `vercel.json` contains no `regions` key, and no region setting appears
anywhere else in the repository.

Vercel documents the default as **`iad1` (Washington, D.C., USA)** for all new projects
([Configuring regions](https://vercel.com/docs/functions/configuring-functions/region)).

**Honest limit on this finding:** a project-level default region can also be set in the Vercel dashboard
(Settings → Functions → Function Regions), which is **not visible from the repository**. The effective
region must be confirmed in the dashboard before any decision is finalised. If it is still `iad1`, every
image request would cross the Atlantic twice against EU-resident storage.

### Available European regions

From [Vercel — Global network and regions](https://vercel.com/docs/regions):

| Code | Location | In EU? |
|---|---|---|
| `fra1` | Frankfurt, Germany | Yes |
| `cdg1` | Paris, France | Yes |
| `dub1` | Dublin, Ireland | Yes |
| `arn1` | Stockholm, Sweden | Yes |
| `lhr1` | London, United Kingdom | **No** — outside the EU |

Also relevant: `dxb1` (Dubai) is the closest compute region to Syria, and `yul1` (Montréal) is the only
Canadian region.

### [OWNER DECISION 2026-07-22 — D-1 REMAINS OPEN]

**No region will be recommended as final, and no Vercel configuration will be changed.** The owner
directed that the database path be established first. That investigation is below; the earlier
`fra1` suggestion is **withdrawn as a recommendation** and retained only as an option pending the
database decision.

#### Database path — investigated 2026-07-22 (read-only; no credential values read or printed)

| Question | Finding |
|---|---|
| **Provider** | **Neon** (serverless Postgres on AWS). Evidence: `.env.production.example` uses the host form `ep-xxxx-pooler.REGION.aws.neon.tech`. Only the host portion was parsed; no credential value was read or printed |
| **Region** | **Not determined.** The production template carries the literal placeholder `REGION` — it has never been filled in |
| **Explicitly configured or inferred?** | **Neither.** There is no configured production database region anywhere in the repository. Local development and the test suite both point at `127.0.0.1` (local Postgres) |
| **Honest limit** | If a production Neon project already exists, it was created outside this repository. Its region is visible only in the Neon console and **must be checked there** — it cannot be determined from this codebase |

#### The finding that changes the sequencing

**A Neon project's region is immutable**, exactly like the R2 jurisdiction — Neon: *"After you select a
region for a Neon project, it cannot be changed for that project."* Moving requires creating a new project
and migrating the data
([Neon — regions](https://neon.com/docs/introduction/regions)).

There are therefore **three regional decisions, two of which are irreversible**:

| Decision | Reversible? | Status |
|---|---|---|
| R2 jurisdiction | **No** | **Decided — EU** |
| **Neon region** | **No** | **OPEN — and not yet recorded anywhere** |
| Vercel runtime region | **Yes** (config change) | OPEN |

**Consequence: the Neon region should be decided before the Vercel region, not after.** The Vercel region
can be changed later at low cost; the Neon region cannot. Choosing the runtime first would risk anchoring
a reversible decision and then discovering the irreversible one conflicts with it.

Neon's European options are `aws-eu-central-1` (Frankfurt) and `aws-eu-west-2` (London). London is
outside the EU, which matters if regional consistency with the EU storage jurisdiction is wanted.

#### Latency trade-off — database path versus R2 path

The two paths have very different traffic profiles:

| Path | Frequency | Payload |
|---|---|---|
| runtime ↔ Postgres | **Every request** (auth, authorization, listings, bookings) | Small, but often several round trips per request |
| runtime ↔ R2 | **File requests only** | Large (up to 8 MB), traversing the leg twice under the proxy model |

So the database leg dominates *request count* while the R2 leg dominates *bytes*. Optimising the runtime
for R2 while leaving the database in another continent would make the common path worse to improve the
rarer one — which is why this was flagged rather than settled.

| Scenario | runtime↔DB | runtime↔R2 | Assessment |
|---|---|---|---|
| Vercel `fra1` + Neon `aws-eu-central-1` + R2 EU | Same metro | Same jurisdiction | **Coherent** — both legs short; consistent with the EU residency decision |
| Vercel `fra1` + Neon US region | Transatlantic on **every request** | Short | **Poor** — optimises the rare path, degrades the common one |
| Vercel `iad1` (current default) + Neon US + R2 EU | Short | Transatlantic on every file byte, twice | Current trajectory if nothing is decided |
| Vercel `dxb1` + Neon EU + R2 EU | Long | Long | Closest to Syrian users, worst on both backend legs |

#### Options for the owner (no option selected)

- **Option 1 — Frankfurt throughout:** Neon `aws-eu-central-1`, Vercel `fra1`, R2 EU. Both backend legs short; consistent with the residency decision. Costs: Syrian users are ~2,800 km from the runtime; regional pricing differs from `iad1` and should be checked.
- **Option 2 — Decide Neon first, defer Vercel:** commit only to the Neon region now (irreversible), leave the Vercel region until real latency data exists from the closed beta. Lowest-regret sequencing.
- **Option 3 — Keep the `iad1` default:** no change. Every image request crosses the Atlantic twice against EU storage. Not recommended, but it is the current state if nothing is decided.

#### Still required before any region decision

- [ ] Confirm in the **Neon console** whether a production project already exists and, if so, its region
- [ ] Confirm the **effective Vercel region** in the dashboard (may differ from the `iad1` default; not visible from the repository)
- [ ] Confirm the **Vercel plan tier** (Hobby is single-region; Pro allows 5)
- [ ] Compare **regional pricing** for the candidate regions on both platforms

**D-1 remains OPEN. No region will be selected or changed without explicit owner approval.**

#### Options previously tabled (retained, not recommended)

| Environment | Option | Reasoning |
|---|---|---|
| Staging | `fra1` (Frankfurt) | Same geography as the EU buckets, so staging exercises production's latency profile |
| Production | `fra1` (Frankfurt) | Shortest `runtime↔R2` leg; EU member state, consistent with the storage jurisdiction |

**Why not `dxb1` (Dubai), despite being closest to Syrian users.** Approximate distances from Damascus:
Dubai ~2,000 km, Frankfurt ~2,800 km. But with EU-resident storage the Dubai option pays a second, longer
leg (Dubai↔EU, ~4,500 km) on every byte — roughly 6,500 km total versus roughly 2,800 km via Frankfurt.
Dubai would only become the better choice if the storage jurisdiction moved, which it cannot.

**Why not `lhr1` (London).** Good connectivity, but the UK is outside the EU; pairing a non-EU runtime with
EU-jurisdiction storage introduces a cross-border question for no latency benefit over Frankfurt.

### Trade-offs and constraints

- **Plan limits.** Hobby is single-region; Pro allows 5 regions; Enterprise allows all. The current plan
  must be confirmed before assuming multi-region is available.
- **Regional pricing varies by region** — Frankfurt and Washington D.C. are not necessarily priced alike;
  Vercel publishes per-region pricing and it should be checked before committing.
- **Failover.** Vercel documents multi-region failover as an Enterprise feature. On lower plans a regional
  outage means downtime, unchanged by this decision.
- **Databases too.** The recommendation optimises `runtime↔R2`. If the Postgres instance sits in a
  different geography, moving the runtime to Frankfurt could *worsen* database latency. **The database
  region must be checked before this is finalised** — it may be the more significant factor, since every
  request touches the database while only file requests touch R2.
- **Beta scale.** At 5–10 hosts and 20–30 guests, none of this will be user-visible. It matters for the
  growth path and for not having to re-decide later.

### Exact owner choice required

- [ ] Confirm the effective current region in the Vercel dashboard (may differ from the `iad1` default).
- [ ] Confirm the Postgres region, so the runtime is not optimised for R2 at the database's expense.
- [ ] Approve **`fra1` for staging and production**, or select alternatives.
- [ ] Confirm the Vercel plan tier (single-region vs multi-region availability).

**No `regions` key will be added to `vercel.json` and no dashboard region will be changed until this is
explicitly approved.**

---

## 15. Rate limiting and fail mode — approved direction (D-2)

**[OWNER DECISION 2026-07-22 — approved direction. Not implemented. Rules recorded here for the
implementation phase.]**

Threat reference: STG-20. Current state: `DOCUMENT_ACCESS` is limited to 30/min per user with
`failMode: 'open'`; the public media proxy route is **not named in the limiter rules at all**.

### 15.1 Private identity and verification documents (class B/C) — fail-closed

| Rule | Value / behaviour |
|---|---|
| Scope | `GET /api/me/id-document/file`, `GET /api/admin/id-document/:userId/file`, listing/thread/driver/Quebec document reads |
| Limit | Explicit per-user limit (retain 30/min as the starting point; tune with evidence) |
| **Fail mode** | **`closed`** — if the limiter dependency cannot be evaluated, the request is refused |
| Response when the limiter cannot be evaluated | **Truthful temporary-unavailable** (`503`, with `Retry-After`), **not** `429` and **never** the object. The response must not imply the caller did something wrong when the platform simply cannot evaluate the request safely |
| Governing principle | **A private document is never released merely because Redis is unavailable.** Availability of a limiter is not a reason to relax access control |

Distinguish the two states in the response: *rate limit exceeded* (`429`) versus *cannot evaluate safely*
(`503`). Both refuse; only one is the caller's fault.

### 15.2 Public / approved listing media — bounded, availability-aware

Fail-closed is **not** appropriate here: making every ordinary image request depend on a fragile global
limiter would turn a limiter outage into a total site outage, for content that is intentionally public.

| Rule | Value / behaviour |
|---|---|
| Scope | `GET /api/listings/:id/media/file/:key` |
| Limit | A dedicated bounded policy — per-IP request rate plus a per-window byte budget, since bytes not requests are the real cost under the proxy model |
| **Fail mode** | **`open`**, but with a **local in-process ceiling** that still applies when the shared store is unavailable, so an outage degrades the limit rather than removing it |
| Repeated missing-object probes | Separate, tighter limit on responses that resolve to "not found", to blunt enumeration and probe amplification |
| Draft media | Follows the **private** policy in §15.1, not this one — draft photos are not public |
| Range requests | Bound the response size; do not honour unbounded or overlapping range requests |

### 15.3 To be decided at implementation time

- Exact numeric limits and window sizes (start from the existing policy, tune with real traffic).
- Whether the byte budget is per-IP, per-session, or both.
- Whether a `503` from the private path should alert once monitoring exists (STG-22).

---

## 16. Evidence replacement governance — approved (D-3)

**[OWNER DECISION 2026-07-22 — governance approved. Scope boundary defined below; the full lifecycle is
NOT part of the storage item.]**

Threat reference: STG-16. **Governing rule: a worker may not silently overwrite evidence after it has been
submitted for review.**

### 16.1 Approved conceptual lifecycle

```
Draft evidence → Submitted → Under review → Replacement requested/initiated
   → New evidence submitted → Prior evidence retained per retention and audit rules
   → Reviewer evaluates the current version
```

State that must be preserved across a replacement: prior object reference (where retention permits),
submission timestamp, replacement timestamp, actor, reason, review state, audit trail, legal-hold state.

Replacement must **never**: erase earlier review history · silently change an approved record · bypass a
correction-required state · delete evidence under legal hold · expose the prior private object to
unauthorized users.

### 16.2 Scope boundary — what the storage item does and does not do

**IN scope for the storage item** (required for safe replacement semantics — without these, replacement is
unsafe at the storage layer):

1. Ordered replacement: write new object → update the reference → delete the superseded object.
2. Legal-hold check **before** any object deletion (invariant 11, 17).
3. The superseded object must not remain retrievable by unauthorized users (STG-15).
4. Concurrent replacement must not leave two objects both believed current.
5. A stale delete request must not remove a newer object (version/key-targeted deletes).

**OUT of scope for the storage item** (product/workflow layer, tracked separately):

6. The `Under review` / `Replacement requested` / `Correction required` **state machine** itself.
7. Blocking a host from replacing evidence **while it is under review** — a product rule.
8. Capturing a replacement **reason** from the user.
9. Reviewer-facing version history UI.
10. Retention policy for superseded identity documents — note that today `me.mjs` **deletes** the previous ID document on replacement, which is a deliberate privacy choice but conflicts with "prior object reference retained where retention permits". **This tension must be resolved by the owner before item 10 is built; the storage item does not change the current behaviour.**

**Existing building blocks:** `ListingDocument` already carries `version`, `isCurrent`, `replacesId`,
`legalHold`, `legalHoldReason`, `retentionDeleteAfter`, `deletedAt`. The lifecycle above can be built on
these without schema change; identity documents (`User.idDocumentRef`) have no equivalent versioning and
would need it.

---

## 17. STG-12 and STG-24 — required Phase 1 mitigations (D-4)

**[OWNER DECISION 2026-07-22 — both APPROVED as required Phase 1 mitigations.]**

### 17.1 STG-12 — Private document download disposition

Private PDFs must not render inline by default in an authenticated browser session.

| Requirement | Detail |
|---|---|
| Header | `Content-Disposition: attachment` on **class B and C** responses |
| Filename | Sanitised and **server-generated** — never the user-supplied original. Must not be able to inject CR/LF or quote characters into the header |
| Content-Type | Preserved and correct (derived from the stored MIME, not caller-supplied) |
| Authorization | Unchanged — still enforced before any storage call |
| Headers | `nosniff` and the existing approved security headers retained |
| CSP | Defence-in-depth only — **must not be relied on alone** |
| **Exclusion** | **Approved listing media is NOT included** in the forced-download rule; public images continue to render inline |

Tests: private PDF uses attachment disposition · private image follows the approved document policy ·
filename header cannot be injected · unauthorized access still rejected · public media behaviour unchanged.

### 17.2 STG-24 — Staff document-view auditing

Every authorized **staff or administrator** access to class C evidence must emit an audit event.

**Event fields (metadata only):** actor · role · action · document category · governed resource reference ·
reason / support-case reference where required · timestamp · result · environment.

**Must never be logged:** document bytes · credentials · full government identifiers · unnecessary
personal filenames · exact sensitive object keys where a safer reference exists.

**Worker self-access** (a user reading their own document) may follow a different, lighter audit policy;
**staff access must be auditable** without exception.

Open implementation question: whether these events extend `AdminAuditLog` or use a separate access-log
table. `AdminAuditLog` records *decisions*; adding high-volume *view* events to it may distort that
record. To be decided at implementation.

---

## 18. Residual risk status (D-5)

**[OWNER DECISION 2026-07-22]** The four residual risks in the threat model (STG-11 malware scanning,
STG-14 orphans, STG-20 download abuse, STG-21 no checksums) are **NOT finally accepted.**

**Status: PROVISIONALLY TOLERATED FOR TEST IMPLEMENTATION ONLY.**

Reassess after: implementation · security tests · production-like cross-instance verification ·
failure-mode testing · staff-access audit testing · private PDF download testing.

**No residual risk is approved for public launch at this stage.**

---

## 20. Implementation status — PHASES 1–3 COMPLETE (2026-07-22)

Owner-approved and locally checkpointed. Implemented test-first across three reviewed checkpoints.

| Phase | Delivered |
|---|---|
| **1** | Storage abstraction (`server/lib/object-storage.mjs`) with explicit `local`/`s3` driver selection, fail-closed production validation wired into `validateProductionConfig()`, test-environment guard at boot **and** at driver use, media/document bucket-class isolation, UUID object keys, safe-key validation |
| **2** | Media upload and retrieval on durable storage, magic-byte validation, object→metadata ordering with cleanup on metadata failure, `Content-Length` on serve, honest deletion ordering |
| **3** | Private-document upload and retrieval, forced `Content-Disposition: attachment` with a server-derived filename, fail-closed worker/staff authorization, staff-access audit event (metadata only), replacement preserving durable-new-object-first ordering |

### Approved allowlists (exact — must not be broadened without an owner decision)

| Path | Allowed |
|---|---|
| **Media** | `image/jpeg` · `image/png` · `image/webp` |
| **Documents** | `application/pdf` · `image/jpeg` · `image/png` |

Both are enforced twice: against the declared MIME type **and** against the actual file signature.
Explicitly rejected on the document path and locked by regression test: WebP, GIF, SVG, HEIC, TIFF,
ZIP, executables, office documents.

### Findings closed

- **STG-12** — private documents are served as `attachment` with a sanitised, server-derived filename; no inline rendering.
- **STG-24** — staff access to private documents emits an audit event containing metadata only.

### Findings still open

| Ref | Status |
|---|---|
| **STG-11** | Deep parsing, malware scanning and content disarm remain future hardening. Signature validation ≠ malware scanning ≠ safe internal structure |
| **STG-14** | Orphan reconciliation remains future hardening; the process-crash window between object write and metadata commit is documented, not eliminated |
| **D-7** | Superseded identity-document retention is governed separately; current approved replacement behaviour is preserved and no retention logic was introduced |
| **byteSize** | Computed at upload but **not persisted** — no column exists and none was added |
| **Audit purpose/case reference** | `AdminAuditLog` has no column for why a staff member opened a document; not invented |
| **Audit failure alerting** | Audit write failure is non-blocking and has no alert routing (depends on STG-22) |
| **Ride / Quebec document modules** | `driver-document-storage.mjs` and `quebec-document-storage.mjs` remain on the local filesystem, **explicitly out of this scope** under the Ride restriction and the Quebec freeze. They still carry the original ephemeral-storage defect and require a separate owner decision |

### Validation at completion

TypeScript clean · unit **301/301** (23 files) · API **462/462** (61 files) · security **21/21** (4 files) ·
production build clean · `npm audit --omit=dev` **0 vulnerabilities**.

---

## 19. Pre-implementation architecture decision checkpoint — D-1 · D-6 · D-7

**Date:** 2026-07-22 · **Status:** all three OPEN · **Implementation remains CLOSED.**

Storage configuration verification has passed 12/12 (variables, endpoint format, bucket names, driver,
environment separation, git protection, and both credential-shape checks). These three decisions are the
remaining gate. No dependency installed, no test written, no source modified, no network access.

---

### D-1 — Vercel runtime region

**Exact decision required:** which Vercel region executes the SYBNB API functions, for staging and for
production.

**Dependency, reconfirmed:** `Neon database region → Vercel runtime region`. Under the approved proxy
architecture every byte travels `user → runtime → R2 → runtime → user`, and every request also touches
Postgres. The runtime should sit close to **both** stores; the database is the higher-frequency path
(every request) while R2 carries the larger payloads (file requests only). **Neither region is assumed
here.**

**Does the Neon project already exist?** **Cannot be established locally — OWNER INPUT REQUIRED.**
Evidence gathered without network access:

| Source | Finding |
|---|---|
| `.env.production.example` | Host template `ep-xxxx-pooler.REGION.aws.neon.tech` — `REGION` is an **unfilled placeholder** |
| `.env`, `.env.test` | `127.0.0.1` — local Postgres, no Neon |
| `.env.local` (shared) | No `DATABASE_URL` at all |
| Repository code/config | No Neon region identifier anywhere. The only `neon.tech` occurrence is a hostname in `server/lib/test-db-guard.mjs`, a safety allowlist — not a region |

**No Neon project or region is recorded in this repository.** Whether a project exists at all can only be
confirmed in the Neon console.

**Options** (Vercel EU regions; `lhr1` London is outside the EU):

| Option | Region | Fit |
|---|---|---|
| **1** | `fra1` Frankfurt | Closest to EU R2; EU member state; matches `aws-eu-central-1` if Neon is placed there |
| 2 | `cdg1` Paris / `dub1` Dublin / `arn1` Stockholm | Equivalent EU alternatives |
| 3 | `lhr1` London | Good connectivity, **non-EU** — introduces a cross-border question for no latency gain over `fra1` |
| 4 | `iad1` Washington D.C. (current default) | Transatlantic on every file byte, twice |
| 5 | `dxb1` Dubai | Closest to Syrian users (~2,000 km) but ~4,500 km from EU storage — ~6,500 km total vs ~2,800 km via Frankfurt |

**Recommendation:** **`fra1` for staging and production — conditional on Neon being placed in
`aws-eu-central-1` (D-6).** If Neon is already provisioned elsewhere, this recommendation changes and must
be recomputed against the actual database location. No Vercel project has been created or modified.

| Impact | Assessment |
|---|---|
| **Security** | Neutral. Region does not change authorization, which is application-enforced |
| **Privacy** | Indirect but real: the runtime processes personal data in transit and holds it in memory. An EU runtime is consistent with the EU storage jurisdiction; a non-EU runtime creates a transfer question (tracked as EV-07) |
| **Operational** | Regional pricing differs by region and must be compared. Hobby is single-region, Pro allows 5. Multi-region failover is Enterprise-only |
| **Launch** | Not a closed-beta blocker at 5–10 hosts / 20–30 guests. Matters for the growth path |
| **Reversibility** | **Reversible** — a `vercel.json` `regions` key or dashboard setting, changeable at any time |
| **Blocked if unresolved** | Nothing in implementation. The default `iad1` would simply pair a US runtime with EU storage — a performance and coherence problem, not a correctness one. **Should be settled before the closed beta, not before implementation** |

---

### D-6 — Neon Postgres region

**What D-6 refers to, from the decision register verbatim** (`STR_STORAGE_THREAT_MODEL.md` §8):

> **D-6** — **Neon Postgres region** — irreversible once a project is created; never chosen; not recorded
> anywhere. Must be decided **before** D-1. Neon EU options: `aws-eu-central-1` (Frankfurt),
> `aws-eu-west-2` (London — outside the EU).

**Exact decision required:** the AWS region in which the production Neon Postgres project is created.

**Current status: OPEN.** **Why it remains open:** it has never been chosen, is recorded nowhere in the
repository, and — critically — **a Neon project's region cannot be changed after creation**
([Neon — regions](https://neon.com/docs/introduction/regions)). Moving requires a new project and a data
migration. This is the same immutability property as the R2 jurisdiction, which is why D-6 precedes D-1.

**Choices:** `aws-eu-central-1` (Frankfurt, EU) · `aws-eu-west-2` (London, **non-EU**) · a non-European
AWS region.

**Recommendation:** **`aws-eu-central-1` (Frankfurt)** — same jurisdiction as the approved EU R2 buckets,
co-located with the recommended `fra1` runtime, and it keeps one coherent EU story across storage,
database and compute.

| Impact | Assessment |
|---|---|
| **Security** | Neutral to the storage design |
| **Privacy** | **High.** The database holds the personal data that the identity documents belong to — names, emails, verification state. Splitting database and object storage across jurisdictions would undermine the residency position taken for R2 |
| **Operational** | Determines latency on the highest-frequency path. Also fixes the backup/restore geography |
| **Launch** | Public-launch relevant; not a technical blocker for the closed beta |
| **Reversibility** | **IRREVERSIBLE** — new project plus full data migration |
| **Blocked if unresolved** | **Storage implementation is not blocked.** D-1 is blocked, because the runtime should follow the database. Any production deployment is blocked |

---

### D-7 — Superseded identity-document retention

**Exact decision required:** what happens to the **previous** identity document once a replacement is
submitted or verified.

**The conflict, restated:** `server/routes/me.mjs` currently **deletes** the prior object as soon as the
new reference is written — a deliberate privacy-minimising choice. The D-3 evidence-replacement
governance says prior evidence is *"retained according to retention and audit rules"*. Both cannot hold.

**Options assessed**

| | A — Immediate deletion | B — Time-limited restricted retention | C — Indefinite retention | D — Retention only under a hold |
|---|---|---|---|---|
| **Privacy minimisation** | Best | Good | **Worst** | Very good |
| **Fraud investigation** | **None** — no prior copy to compare | Good within the window | Best | Good where a hold is raised, none otherwise |
| **Auditability** | Weak — no evidence of what was replaced | Good within window | Best | Good for held cases |
| **Legal hold** | **Conflicts** — deletes material a hold may require | Compatible if the hold suspends expiry | Compatible | **Designed for it** |
| **User expectations** | Matches "replaced means gone" | Reasonable if disclosed | Likely violates expectations | Reasonable if disclosed |
| **Breach impact** | Lowest | Bounded by window | **Highest** — every historical ID | Low, bounded by held cases |
| **Deletion verification** | Simple | Needs a scheduler and proof of expiry | n/a | Needs hold-state correctness |
| **Operational complexity** | Lowest | Medium | Low to build, high to govern | **Highest** — depends on correct hold state |

**Recommended Phase 1 policy: D as the governing rule, with A as the default and a short B window for
failed verification.**

| Scenario | Policy |
|---|---|
| **Ordinary replacement** (prior document approved or unreviewed, no hold) | **Delete the prior object** once the new one is durably stored and referenced. Preserves current behaviour and privacy minimisation |
| **Failed verification / rejection** | **Retain briefly in restricted storage** (suggest 30 days) so the user can appeal or resubmit and an admin can compare against a repeat submission. Then delete |
| **Suspected fraud** | **Retain under an explicit hold.** No automatic deletion while the hold stands |
| **Open dispute** | **Retain under an explicit hold**, released when the dispute closes |
| **Legal or regulatory hold** | **Retain until the hold is lifted.** Overrides every rule above — this is the existing `legalHold` semantics in `listing-document-retention.mjs` |

**Why this shape:** it keeps the privacy-minimising default that already exists, adds retention only where
there is a *named reason*, and makes legal hold supreme — which is exactly the invariant the threat model
requires (STG-17, invariants 11 and 17).

| Impact | Assessment |
|---|---|
| **Security** | Retained documents enlarge the sensitive-data footprint; every retained object must remain under the same authorization and audit controls |
| **Privacy** | **Highest-stakes decision of the three.** Governs how long government identity documents persist. Option C would be difficult to defend |
| **Operational** | Requires hold state on identity documents, which **does not exist today** — `User.idDocumentRef` has no versioning, `legalHold`, or `replacesId` equivalent (unlike `ListingDocument`) |
| **Launch** | Closed-beta relevant: real identity documents will be replaced during the beta |
| **Reversibility** | **Asymmetric and important.** Moving from retention → deletion is easy. Moving from deletion → retention **cannot recover already-deleted documents**. Choosing A now forecloses reconstructing history later |
| **Blocked if unresolved** | **Storage implementation is NOT blocked** — the storage item preserves current behaviour unchanged. Blocked: the D-3 replacement lifecycle, and any claim that evidence is auditable across replacements |

**Not implemented.** No retention logic is written, and the storage item does not change current
identity-document replacement behaviour.

---

### Checkpoint summary

| Decision | Status | Blocks implementation? | Reversible? |
|---|---|---|---|
| **D-1** Vercel runtime region | OPEN — depends on D-6 | No | Yes |
| **D-6** Neon Postgres region | OPEN — **owner input required**; project existence unknown locally | No | **No** |
| **D-7** Superseded ID retention | OPEN | No | **Asymmetric** — deletion is irreversible |

**None of the three blocks storage implementation.** All three block a production deployment; D-7 should be
settled before real identity documents are replaced in the closed beta.

---

## 13. Proposed sequence (after approval)

1. Owner answers D1–D8.
2. Write the §7 tests. Confirm they fail — in particular test 11 (cross-instance durability), which must fail against the current local driver.
3. Implement `object-storage.mjs` with both drivers.
4. Re-point the six modules. No route changes.
5. Add magic-byte sniffing.
6. Extend `validateProductionConfig()` and the test/production bucket guard.
7. Update `.env.example` and `.env.production.example`.
8. Run all gates: TypeScript → unit → API → security → production build.
9. Execute §9 production-like verification against the real backend.
10. Stop. Report. Await approval before any commit.

**Estimated effort:** 2–3 days including verification, assuming a staging bucket and credentials are
available. The uniform module interface and unchanged route layer are what keep this small.
