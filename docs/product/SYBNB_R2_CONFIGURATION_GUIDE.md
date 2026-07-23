# SYBNB — Cloudflare R2 Configuration Guide (PREREQUISITE — nothing created or configured)

**Date:** 2026-07-22
**Status:** Configuration requirements only. **No code written, no dependencies installed, no buckets created, no Cloudflare settings changed.**
**Purpose:** everything the owner needs to provision before persistent-storage implementation can begin.
**Approved decisions this guide implements:** Cloudflare R2 · `@aws-sdk/client-s3` · fully private buckets · application-proxy delivery for **both** media and documents · **no signed URLs** in the first implementation · no migration of existing local files.
**Companion:** `SYBNB_PERSISTENT_OBJECT_STORAGE_IMPLEMENTATION_PLAN.md`

> **This document contains no secrets and no example credentials.** Every credential is shown as a
> named placeholder (`<R2_ACCOUNT_ID>`, `<ACCESS_KEY_ID>`, …). Nothing here should be filled in and
> committed — real values belong only in `.env` files (gitignored) and the Vercel environment store.

> **Verification note:** the Cloudflare dashboard's exact menu labels change over time. Where this
> guide names a dashboard path, treat it as a description of the *setting required*, not a guarantee
> of the current click-path. Every requirement below is stated so it can be satisfied however
> Cloudflare currently exposes it.

---

## 0. Owner decision record — 2026-07-22 (supersedes earlier placeholders in this guide)

Two decisions were open when this guide was first written and are now resolved. **The original text
below is left in place; the changes are called out here and marked `[SUPERSEDED]` where they occur.**

| Item | Original state in this guide | Resolved |
|---|---|---|
| **Data residency** | Open — "this guide does not choose for you" (§1) | **EU jurisdiction (`eu`) for all six buckets.** Automatic placement, `wnam`, `enam`, `fedramp` and mixed EU/standard layouts are excluded |
| **Production bucket names** | `sybnb-prod-media`, `sybnb-prod-documents` | **`sybnb-production-media`, `sybnb-production-documents`.** The `prod` abbreviation must not appear in new configuration |

**Endpoint model — one class for all six buckets.** EU-jurisdiction buckets are reached at a
jurisdiction-scoped host:

```
STORAGE_S3_ENDPOINT="https://<R2_ACCOUNT_ID>.eu.r2.cloudflarestorage.com"
```

per [Cloudflare — R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)
(`https://<ACCOUNT_ID>.<JURISDICTION>.r2.cloudflarestorage.com`). Because every bucket shares the EU
jurisdiction, **a single `STORAGE_S3_ENDPOINT` remains correct** — the per-bucket-class endpoint split
that a mixed layout would have required is not needed. **Do not mix R2 endpoint classes in Phase 1.**

**Known limitation accepted with this choice:** Cloudflare documents that Logpush cannot interact with
jurisdiction-restricted R2 resources. SYBNB does not use Logpush, so this is not currently a constraint.

**Not a legal conclusion.** Selecting the EU jurisdiction is a technical infrastructure decision. It is
not a determination about GDPR applicability, Canadian privacy obligations, Syrian privacy or
data-localization requirements, international transfers, sanctions or export control, or Cloudflare and
Vercel eligibility to serve users in Syria. Those are tracked as separate launch gates in
`SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md`.

**No Canada-specific residency is claimed** — R2 offers no Canadian jurisdiction and no Canadian
location hint.

---

## 1. Required Cloudflare account configuration

| Requirement | Value / notes |
|---|---|
| Cloudflare account | Any plan that includes R2. R2 requires billing to be enabled even within the free allowance |
| R2 subscription | Enabled on the account (**R2 → Overview → enable**) |
| Account ID | Needed for the S3 endpoint. Visible in the dashboard URL and on the R2 overview page. **Not a secret in the credential sense, but do not publish it** — treat it as configuration |
| Data location | R2 buckets are created with a **location hint** (or a jurisdiction). See §6 and the residency note below |
| Users with access | Restrict R2 admin access to the smallest possible set of accounts; enable 2FA on each |

**[SUPERSEDED 2026-07-22 — RESOLVED, see §0]** ~~**Data-residency decision (owner input needed).**
… This guide does not choose for you; see §17 and the decision list at the end.~~

**Data residency — RESOLVED: EU jurisdiction (`eu`) for all six buckets.** Identity documents of Syrian
hosts and guests are stored in the `documents` buckets. R2 distinguishes a **location hint** (best-effort
placement) from a **jurisdiction** (a guarantee that objects are stored within it); only a jurisdiction is
a residency position, which is why one was chosen. Available jurisdictions are `eu` and `fedramp` only —
**there is no Canadian jurisdiction and no Canadian location hint**, so no Canada-aligned residency is
available or claimed.

The choice is made **at bucket creation and cannot be changed afterwards** — a change requires new buckets
and a full object copy. Rationale and sources:
`SYBNB_R2_DATA_RESIDENCY_OWNER_DECISION_BRIEF.md`.

---

## 2. Required bucket configuration

Six buckets total — two classes × three environments. Local development and automated tests use the
local filesystem driver and need **no bucket** (see §14, §15).

**[SUPERSEDED 2026-07-22 — see §0]** Production names use `production`, not `prod`. **Every bucket is
created in the EU jurisdiction.**

| Bucket | Class | Environment | Jurisdiction | Purpose |
|---|---|---|---|---|
| `sybnb-test-media` | media | verification | `eu` | Mandatory production-like verification |
| `sybnb-test-documents` | documents | verification | `eu` | Mandatory production-like verification |
| `sybnb-staging-media` | media | staging | `eu` | Pre-production |
| `sybnb-staging-documents` | documents | staging | `eu` | Pre-production |
| `sybnb-production-media` | media | production | `eu` | Live listing photos |
| `sybnb-production-documents` | documents | production | `eu` | Live identity/verification documents |

**Jurisdiction must be selected at creation, before the bucket exists** — it cannot be changed
afterwards. If an approved name is unavailable in the account, **stop and report the conflict**; no name
may be altered silently.

**Settings required on every bucket:**

| Setting | Required value | Why |
|---|---|---|
| Public access (`r2.dev` subdomain) | **DISABLED** | Approved decision: fully private buckets. Enabling this would expose objects by URL and bypass every authorization check the application performs |
| Custom domain | **NOT configured** | Same reason. A custom domain on an R2 bucket serves objects publicly |
| Public bucket policy | **NONE** | No policy granting anonymous read |
| Object versioning | Optional — see §11 | Not required for the first implementation |
| Location hint / jurisdiction | Chosen once at creation (§1) | Immutable afterwards |

**The single most important setting in this document:** `sybnb-production-documents` must never have public
access or a custom domain enabled. Enabling it would make every host and guest identity document
retrievable by anyone who can guess or obtain an object key, with no authentication.

**Bucket name constraints (Cloudflare):** lowercase letters, digits and hyphens; 3–63 characters; must
begin and end with a letter or digit. The names above comply.

---

## 3. Required API token permissions

Create R2 API tokens under **R2 → Manage R2 API Tokens**. Each token yields an **Access Key ID** and a
**Secret Access Key** (the S3-compatible credential pair). **The secret is shown exactly once at
creation** — capture it directly into the target environment store; do not paste it into a chat, a
document, a screenshot, a ticket, or a commit.

**Create one token per environment, never one shared token:**

| Token | Permission | Scope | Consumed by |
|---|---|---|---|
| `sybnb-test-storage` | **Object Read & Write** | `sybnb-test-media`, `sybnb-test-documents` only | Local verification runs |
| `sybnb-staging-storage` | **Object Read & Write** | `sybnb-staging-*` only | Staging deployment |
| `sybnb-production-storage` | **Object Read & Write** | `sybnb-production-*` only | Production deployment |

**Permission rules:**

- Use **Object Read & Write**, never **Admin Read & Write**. The application needs to put, get and
  delete objects. It never needs to create buckets, change bucket settings, or enable public access —
  and an application token that *can* enable public access is a one-bug path to exposing every ID document.
- **Scope each token to its own buckets explicitly.** An account-wide token means a staging
  misconfiguration can write to, or delete from, production.
- Do not reuse the test token for staging or production. The test token will be present on a developer
  machine; treat it as the least-trusted of the three.
- Set an expiry on the test token (e.g. 90 days) and rotate it.

---

## 4. Required environment variables

Names match `SYBNB_PERSISTENT_OBJECT_STORAGE_IMPLEMENTATION_PLAN.md` §8.

| Variable | Secret? | Local dev | Automated test | Verification | Staging | Production |
|---|---|---|---|---|---|---|
| `STORAGE_DRIVER` | no | `local` | `local` | `s3` | `s3` | `s3` |
| `STORAGE_S3_ENDPOINT` | no | — | — | required | required | required |
| `STORAGE_S3_REGION` | no | — | — | `auto` | `auto` | `auto` |
| `STORAGE_S3_ACCESS_KEY_ID` | **yes** | — | — | required | required | required |
| `STORAGE_S3_SECRET_ACCESS_KEY` | **yes** | — | — | required | required | required |
| `STORAGE_BUCKET_MEDIA` | no | — | — | `sybnb-test-media` | `sybnb-staging-media` | `sybnb-production-media` |
| `STORAGE_BUCKET_DOCUMENTS` | no | — | — | `sybnb-test-documents` | `sybnb-staging-documents` | `sybnb-production-documents` |
| `STORAGE_LOCAL_DIR` | no | defaults to `server/uploads` | temp dir | — | — | — |

**Endpoint format:**

```
STORAGE_S3_ENDPOINT="https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com"
```

**Region** must be the literal string `auto`. R2 does not use AWS regions; `@aws-sdk/client-s3` requires
*some* region value, and `auto` is the value R2 expects.

**Placement rules:**

- **Never** prefix any storage variable with `VITE_`. Vite inlines `VITE_*` into the client bundle —
  that would publish the credentials to every visitor.
- Production and staging values go in the **Vercel environment store**, scoped to the matching
  environment, never in a committed file.
- `.env.example` and `.env.production.example` get the **variable names with empty or placeholder
  values only**, so the required shape is discoverable without leaking anything.
- Credentials must never appear in logs, error messages, stack traces, test output, or screenshots.
  Error handling must surface the operation that failed and the bucket *class*, never the endpoint,
  key id, or secret.

**Production must fail closed.** `validateProductionConfig()` (`server/lib/env.mjs`) must refuse to boot
when `NODE_ENV=production` and any of these hold: `STORAGE_DRIVER !== 's3'`; endpoint, key id, secret, or
either bucket name missing; or a bucket name containing `test`, `dev`, `staging`, or `local`. This mirrors
the existing fail-closed treatment of `DATABASE_URL`, `CORS_ORIGIN` and the Upstash Redis credentials, and
is what prevents a silent fallback to ephemeral local disk.

---

## 5. Bucket naming strategy

```
sybnb-<environment>-<class>
        │             └── media | documents
        └── test | staging | prod
```

**Separate buckets per environment, not shared buckets with key prefixes.** A prefix mistake in code
silently crosses environments — test data lands in production, or worse, a delete sweeps production
objects. A wrong bucket *name* fails loudly and immediately. This is the same reasoning behind the
existing `test-db-guard.mjs`, which refuses to let the test suite touch a non-test database.

`prod` is used rather than `production` only for brevity and consistency; either is acceptable, but the
name must be fixed before any object is written, since renaming an R2 bucket is not possible in place.

---

## 6. Environment isolation

| Environment | Driver | Storage | Isolation guarantee |
|---|---|---|---|
| Local development | `local` | `server/uploads/` | No network, no credentials, cannot reach R2 |
| Automated tests | `local` | temp directory | No credentials; guard rejects any non-local driver under `NODE_ENV=test` |
| Verification | `s3` | `sybnb-test-*` | Token scoped to test buckets only |
| Staging | `s3` | `sybnb-staging-*` | Token scoped to staging buckets only |
| Production | `s3` | `sybnb-production-*` | Token scoped to production buckets only |

**Required guards (to be implemented, not yet written):**

1. `NODE_ENV=production` + `STORAGE_DRIVER=local` → **refuse to boot**.
2. `NODE_ENV=production` + a bucket name containing `test`/`dev`/`staging`/`local` → **refuse to boot**.
3. `NODE_ENV=test` + `STORAGE_DRIVER=s3` → **refuse to run**, so a stray credential in a developer's
   shell can never let the suite write to a real bucket. This mirrors `test-db-guard.mjs`.
4. Automated tests must never read `STORAGE_S3_*` variables at all.

**Residency note:** if the EU jurisdiction or a specific location hint is chosen for
`sybnb-production-documents` (§1), the test and staging document buckets should use the same setting, so
verification exercises the same latency and residency behaviour as production.

---

## 7. Public media architecture

**Approved model: the R2 bucket is private; "public" is a property the application decides per request.**

```
Guest browser
   │  GET /api/listings/<listingId>/media/file/<storageKey>
   ▼
SYBNB API (Vercel function)
   │  1. validate storage-key shape (path-traversal guard)
   │  2. confirm a ListingMedia row binds this key to this listing
   │  3. APPROVED listing → allow anyone; draft → owner/admin only
   │  4. fetch object bytes from R2 (private, server credentials)
   ▼
Response: image bytes + derived Content-Type
```

Steps 1–3 already exist in `server/routes/listings.mjs` and **do not change**. Only step 4 changes: bytes
come from R2 instead of `server/uploads/listing-media/`.

**Why this is the right first implementation:**
- The bucket stays fully private — no public URL exists to leak, guess, or scrape.
- Draft photos remain invisible to competitors, exactly as today.
- Zero change to the authorization model, so nothing regresses.

**The honest trade-off:** image bytes flow through the serverless function, so they consume invocation
time and are not CDN-cached. For a closed beta of 5–10 hosts and 20–30 guests this is not a meaningful
cost. R2 has no egress fees, so the cost is compute, not bandwidth.

**Upgrade path if photo latency later becomes a real problem** (not now, not in this implementation):
short-lived signed URLs, or a Cloudflare custom domain in front of the media bucket **only** if the
product accepts that approved-listing photos become genuinely public. That second option must not be
taken accidentally — it is exactly what §2 forbids by default.

---

## 8. Private document architecture

**Approved model: proxy only. No signed URLs. No public access. Ever.**

Covers identity documents, listing documents, thread attachments, driver documents and Quebec documents.

```
Authenticated user / admin
   │  GET /api/me/id-document/file        (own document)
   │  GET /api/admin/id-document/<userId>/file   (staff)
   ▼
SYBNB API
   │  1. requireAuth — reject before touching storage
   │  2. authorize: caller owns the document, or holds the staff role
   │  3. resolve the storage key from the database row, never from user input
   │  4. fetch object bytes from R2
   ▼
Response: bytes + Cache-Control: private, no-store
```

Steps 1–3 already exist in `server/routes/me.mjs` and `server/routes/admin.mjs` and **do not change**.

**Non-negotiable properties:**

- No object in `*-documents` is ever reachable without an authenticated, authorized request.
- The storage key is **never** taken from a query parameter or path segment supplied by the caller for
  private documents — it is read from the database row after the ownership check.
- Responses keep `Cache-Control: private, no-store` (already present in `me.mjs`).
- No bucket listing capability is exposed to the application's request path; even though the token can
  list, no route may expose enumeration.
- Signed URLs are **out of scope for the first implementation** by owner decision. An identity document
  should not have a URL that works outside an authenticated request, even briefly.

---

## 9. Authorization model

Authorization is enforced **entirely in the application**, before any R2 call. R2 itself performs no
per-user authorization — it only knows the single service credential.

| Asset | Unauthenticated | Authenticated non-owner | Owner | Staff |
|---|---|---|---|---|
| Approved listing photo | **Allow** (via proxy) | Allow | Allow | Allow |
| Draft listing photo | Deny | Deny | Allow | Allow |
| Own identity document | Deny | Deny | Allow | Allow (ADMIN/SUPPORT) |
| Another user's identity document | Deny | Deny | n/a | Allow (ADMIN/SUPPORT) |
| Listing / thread / driver / Quebec document | Deny | Deny | Allow (participant/owner) | Allow |

**Ordering rule:** authenticate → authorize → resolve key from the database → fetch bytes. A failed
authorization must return before any network call to R2, so a denied request cannot be used to probe
object existence or to generate storage cost.

**Must be proven by test** (§15): a guest cannot read a host identity document; one host cannot read
another host's private documents; a raw object key cannot be used to bypass the row-binding check; and a
replaced or deleted record cannot serve stale private bytes.

---

## 10. Required CORS configuration

**None. No CORS rules are required on any bucket — and adding them would be a mistake.**

CORS on an R2 bucket only matters when a **browser talks to the bucket directly**. In the approved
architecture the browser never does: uploads are posted as base64 in a JSON body to the SYBNB API, and
downloads come back through the API's own file routes. Every request the browser makes is same-origin
with the API, and is already covered by the existing CORS handling in `server/index.mjs` and the
allowlist in `server/lib/allowed-origins.mjs`.

Adding a permissive bucket CORS policy would only be useful in combination with public access or signed
URLs — both of which are explicitly out of scope — and would signal that direct browser access is
intended when it is not.

**Revisit only if** the owner later approves signed URLs or a public media domain. At that point a
narrow CORS policy (specific origins, `GET` and `HEAD` only) becomes necessary and must be designed then.

**Existing application-level CORS is unaffected by this work** and needs no change.

---

## 11. Required lifecycle rules

R2 supports object lifecycle rules per bucket. Two are worth configuring; neither is strictly required
for the first implementation.

| Rule | Bucket(s) | Recommendation |
|---|---|---|
| **Abort incomplete multipart uploads** after 1 day | all | **Recommended.** Cheap hygiene. Uploads are ≤8 MB and unlikely to use multipart, but an interrupted request should not leave billable fragments |
| **Expire objects under a `tmp/` prefix** after 1 day | all | Only if a staging prefix is later introduced. Not needed now — the current design writes no temporary objects |

**Deliberately NOT configured:**

- **No age-based expiry on `*-documents`.** Retention for listing documents is already enforced at the
  database level by `server/lib/listing-document-retention.mjs`, including legal-hold handling. A
  bucket-level expiry rule would delete bytes out from under that logic and could destroy documents
  under legal hold. Aligning object lifecycle with database retention is a **follow-up item**, not part
  of this implementation.
- **No age-based expiry on `*-media`.** Listing photos must live as long as their listing.
- **Orphan cleanup is not a lifecycle rule.** An orphaned object (bytes written, database commit failed)
  is indistinguishable from a live object by age alone. Orphan sweeping requires reconciliation against
  the database and is explicitly deferred in the implementation plan.

**Test bucket only:** a 30-day expiry on `sybnb-test-*` is reasonable so verification artefacts do not
accumulate. Never apply this to staging or production.

---

## 12. Object-key strategy

**Preserve the existing key identity exactly.** Keys are already `randomUUID()` + an extension derived
from the MIME allowlist — never the original filename, never a listing or user id. This is correct and
does not change.

**Namespace by prefix inside the storage service:**

| Namespace | Bucket | Source module |
|---|---|---|
| `media/listing/<uuid>.<ext>` | media | `listing-media-storage.mjs` |
| `media/accommodation/<uuid>.<ext>` | media | `listing-media-storage.mjs` (accommodation-scoped) |
| `media/room-type/<uuid>.<ext>` | media | `listing-media-storage.mjs` (room-type-scoped) |
| `documents/id/<uuid>.<ext>` | documents | `id-document-storage.mjs` |
| `documents/listing/<uuid>.<ext>` | documents | `listing-document-storage.mjs` |
| `documents/verification/<uuid>.<ext>` | documents | verification evidence |
| `documents/thread/<uuid>.<ext>` | documents | `thread-document-storage.mjs` |
| `documents/driver/<uuid>.<ext>` | documents | `driver-document-storage.mjs` |
| `documents/quebec/<uuid>.<ext>` | documents | `quebec-document-storage.mjs` |

**Critical compatibility rule:** the database continues to store the **bare `<uuid>.<ext>` key**, exactly
as today (`User.idDocumentRef`, `*.assetUrl`, and the serve path embedded in `ListingMedia.url`). The
prefix is applied inside the storage service from the caller's namespace. This is what makes the change a
no-migration change — every existing database row stays valid.

**Key safety rules:**
- Original filenames are never used, never stored as identity, and never echoed into a response header
  without sanitising.
- A key arriving from a request must match the existing shape regex before any storage call.
- A key containing `/`, `..`, a leading slash, a null byte, or a caller-supplied prefix must be rejected.
- The namespace prefix is chosen by the calling module, never by the request.

---

## 13. Security checklist

Verify every line before the first production deployment.

**Cloudflare**
- [ ] Public access (`r2.dev`) disabled on all six buckets
- [ ] No custom domain on any bucket
- [ ] No anonymous-read bucket policy
- [ ] Three separate tokens, one per environment
- [ ] Every token is **Object Read & Write**, not Admin
- [ ] Every token scoped to its own buckets only
- [ ] Test token has an expiry set
- [ ] 2FA enabled on all Cloudflare accounts with R2 access
- [ ] Data-residency choice made deliberately and applied consistently (§1, §6)

**Application**
- [ ] No `VITE_`-prefixed storage variable exists anywhere
- [ ] Credentials absent from logs, errors, stack traces, test output and screenshots
- [ ] Production refuses to boot without complete S3 configuration
- [ ] Production refuses to boot with `STORAGE_DRIVER=local`
- [ ] Production refuses a bucket name containing `test`/`dev`/`staging`/`local`
- [ ] Test environment refuses `STORAGE_DRIVER=s3`
- [ ] Authorization runs before every R2 call, on every route
- [ ] Private document responses keep `Cache-Control: private, no-store`
- [ ] Object keys remain random UUIDs; filenames never become identity
- [ ] Key-shape validation precedes every storage call
- [ ] **Magic-byte sniffing added** — declared MIME is verified against the decoded bytes (JPEG, PNG,
      WebP, PDF signatures), per the requirement not to trust browser-provided MIME
- [ ] Existing 8 MB limits and MIME allowlists preserved
- [ ] No bucket-listing capability reachable from any route
- [ ] `.env.example` carries names only, never values

**Explicitly out of scope for this item:** antivirus/malware scanning. None exists in the project today
and the approved plan does not introduce it.

---

## 14. Local-development strategy

**Local development uses the `local` filesystem driver and needs no R2 access, no credentials, and no
bucket.** `npm ci` plus a database continues to be enough to run and develop the project — a developer
should never need a Cloudflare account to work on an unrelated feature.

- `STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR` defaulting to today's `server/uploads` — identical
  behaviour to the current code.
- Existing local files stay where they are. **Nothing is migrated and nothing is deleted** (approved
  decisions 6 and 7).
- A developer who *wants* to exercise the S3 path locally may point `STORAGE_DRIVER=s3` at the **test**
  buckets using the test token — never staging or production.
- MinIO is acceptable purely as a developer convenience if someone wants an offline S3 target. It does
  **not** satisfy the mandatory production-like verification (owner decision 2).

**The known limitation this preserves:** local development still writes to a real disk, so local testing
alone can never reproduce the ephemeral-filesystem defect. That is precisely why §15's cross-instance
test must run against R2.

---

## 15. Test strategy

**Automated suite (`local` driver, no credentials, no network).** The existing 246 unit / 428 API / 21
security tests must continue to pass unchanged. New tests per the implementation plan §7 cover: explicit
driver selection; production refusing the local driver; object-key safety; UUID-based keys not derived
from filenames; magic-byte sniffing; size and MIME rejection; unauthorized upload rejected; unauthorized
private read rejected; failed-metadata-write leaving no dangling reference; replacement and deletion
preserving privacy; and the test environment being unable to resolve a production bucket.

**Mandatory production-like verification (real R2, `sybnb-test-*`).** Local-disk testing is explicitly
insufficient. Required sequence:

```
upload via process A  →  persist metadata  →  terminate process A
                      →  read via process B (no shared local state)  →  succeeds
                      →  restart application  →  read again  →  succeeds
```

This cross-instance read is **the test that would have detected the current defect** and is the single
mandatory gate on the storage item.

Also verified against real R2: public listing-photo route (approved and draft); private identity-document
route (owner and staff); authorization failure paths (guest → host document, host → another host's
document); replacement; deletion; missing object; and behaviour when the storage provider is unavailable.

**Test-data hygiene:** verification writes only to `sybnb-test-*`, uses synthetic data only, and real
identity documents are never uploaded to a test bucket.

---

## 16. Production checklist

**Before deployment**
- [ ] All six buckets created with the deliberate location/jurisdiction choice
- [ ] All §13 security items verified
- [ ] `sybnb-production-storage` token created, scoped, and stored only in Vercel
- [ ] All seven production variables set in Vercel, production scope
- [ ] `.env.example` / `.env.production.example` updated with names only
- [ ] Full automated suite green
- [ ] Cross-instance durability verified against real R2 (§15)
- [ ] Manual: host uploads a photo → appears on the listing
- [ ] Manual: host uploads an ID → admin opens it
- [ ] Manual: unauthorized access denied, AR and EN
- [ ] Boot-failure behaviour confirmed: remove one variable, confirm the deployment refuses to start

**After deployment**
- [ ] Upload a photo and an ID document on the deployed environment
- [ ] **Redeploy, then confirm both are still retrievable** — the property that does not hold today
- [ ] Confirm no object is publicly reachable: request an object URL directly against the R2 endpoint
      with no credentials and confirm it is refused
- [ ] Confirm no credential appears in deployment logs

**Not part of this checklist:** division isolation, fabricated-data removal, roadmap changes, C4, and the
demo-seed remediation. All remain separately gated.

---

## 17. Rollback considerations

**Mechanism.** `STORAGE_DRIVER` is the switch. Reverting to `local` restores the previous code path
immediately — but it also restores the defect, so this is an emergency measure only, valid for minutes,
not days.

**What is safe about this rollback:**
- No database migration is proposed, so there is nothing to reverse in Postgres.
- Key formats and database values are unchanged, so a code revert is clean.
- **Objects already written to R2 are not destroyed by a rollback.** They remain in the bucket and
  re-attach correctly when the deployment rolls forward again.
- The six storage modules keep their existing signatures, so reverting does not require touching routes.

**What is not safe, and must be understood before rolling back:**
- Any file uploaded **while the local driver is active** lives on an ephemeral filesystem and will be
  lost at the next instance replacement. A rollback window is a data-loss window for anything uploaded
  during it. Prefer rolling *forward* with a fix.
- Rolling back does not remove objects already in R2. If a rollback follows a security incident,
  object cleanup is a separate, deliberate action.

**Rollback triggers:** failure of the cross-instance durability check, any authorization regression on
the file routes, or credential exposure.

**On credential exposure:** roll the affected token in Cloudflare immediately (this invalidates the
Access Key ID / Secret pair), issue a new token with the same scope, update the environment store, and
redeploy. Because tokens are per-environment and bucket-scoped, exposure of the test token does not
compromise production.

**Bucket-level rollback does not exist.** Object versioning is not enabled by default (§2); a deletion is
final. This is a further reason the application deletes objects only *after* the database row is updated.

---

## Owner actions required before implementation can begin

1. Decide the **data location / jurisdiction** for the document buckets (§1) — irreversible after creation.
2. Create the **six buckets** (§2), all with public access and custom domains disabled.
3. Create the **three scoped tokens** (§3).
4. Supply the **test-environment values** so verification can run — endpoint, test access key id, test
   secret, and the two test bucket names. Deliver them by a secure channel directly into the environment,
   **not** pasted into this conversation.
5. Confirm the **bucket names** in §2, or supply alternatives, before anything is created.
6. Confirm whether a **staging environment** will exist for this item, or whether verification runs
   against the test buckets only.

**Implementation does not begin until items 1–5 are complete and the test values are in place.**
