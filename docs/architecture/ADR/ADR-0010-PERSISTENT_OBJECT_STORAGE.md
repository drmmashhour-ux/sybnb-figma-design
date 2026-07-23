# ADR-0010 — Persistent Object Storage for User-Uploaded Files

## 1. Title

Adopt Cloudflare R2 as the durable store for all user-uploaded files, accessed exclusively through the
existing SYBNB application proxy routes, with fully private buckets.

## 2. Status

**Accepted — IMPLEMENTED (Phases 1–3), local checkpoint `79a3bbb`.**

~~Accepted — not yet implemented. Implementation is gated on four preconditions recorded in §24.~~
All four preconditions were satisfied before implementation began.

Owner-approved as an architectural decision on 2026-07-22 and implemented the same day across three
reviewed checkpoints: storage abstraction, media path, private-document path.

**Implemented as decided**, with no deviation from §6: Cloudflare R2, EU jurisdiction, six separate
buckets, all private, `@aws-sdk/client-s3`, application-proxy delivery for both media and documents,
no signed URLs, no bucket CORS, no public URLs, no browser credentials, explicit `STORAGE_DRIVER`
selection, UUID object keys, no production filesystem fallback, no schema change, no data migration.

**Approved allowlists (exact), enforced against the declared MIME type *and* the actual file
signature:** media `image/jpeg` · `image/png` · `image/webp`; documents `application/pdf` ·
`image/jpeg` · `image/png`.

**Validation at checkpoint:** TypeScript clean · unit 301/301 · API 462/462 · security 21/21 ·
production build clean · `npm audit --omit=dev` 0 vulnerabilities · secret scan clean · no network
call · no object uploaded to R2.

**This is an implementation checkpoint, not a launch approval.** Production remains unapproved and
unprovisioned: only the two test buckets exist, only test credentials are injected, and staging and
production provisioning have not been performed. The external-verification launch gates
(`SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md`, EV-01…EV-07) all remain OPEN.

~~**Findings closed by this implementation:** STG-12 (private documents forced to attachment
disposition) · STG-24 (staff private-document access audited at the approved boundary).~~

> **CORRECTION — 2026-07-23 (owner decision SYB-004, Wave 0).** The struck-through claim above was
> **inaccurate as written** and is retained rather than deleted so the record shows what was believed
> and when. Neither finding was closed by this implementation:
>
> - **STG-12 — PARTIALLY CLOSED.** Forced download was implemented on the **identity-document path
>   only** (2 routes) while nine routes serve stored private documents. Four further unfrozen routes
>   were remediated on 2026-07-23 under SYB-004, bringing coverage to **6 of 9**. The three remaining
>   routes — `driver.mjs` and `quebec-driver-onboarding.mjs` (×2) — **still render inline** and are
>   intentionally deferred behind the Ride and Québec freezes. No unfreeze is authorized; changing them
>   requires a separate Architecture Change Request and explicit owner approval.
> - **STG-24 — NOT CLOSED. PARTIALLY REMEDIATED.** When this ADR was written, staff document-view
>   auditing had **one** call site covering the identity-document route, against eight staff-reachable
>   routes. Four unfrozen routes were audited on 2026-07-23 under **SYB-005 (scoped accept)**, bringing
>   coverage to **5 of 8**. The three frozen Ride/Québec routes still leave **no record** and require a
>   separate Architecture Change Request, explicit owner approval and a boundary unfreeze. **Four
>   further items remain OPEN and are not resolved by that remediation:** `AdminAuditLog.ipHash` origin
>   attribution (declared, no writer anywhere in `server/`), purpose/case-reference capture,
>   audit-failure alert routing, and the `AdminAuditLog`-versus-dedicated-access-log question — the last
>   deferred as a separate architecture decision.
>
> Route-by-route status for both findings: `docs/security/STR_STORAGE_THREAT_MODEL.md`, *STG-12 —
> corrected implementation status* and *STG-24 — corrected implementation status*. Origin:
> independent review findings **SYB-004** and **SYB-005** (both Critical), confirmed at
> runtime by **E2E-06** and **E2E-07** respectively.

**Findings deliberately left open** — recorded in `STR_STORAGE_THREAT_MODEL.md` and
`SYBNB_PERSISTENT_OBJECT_STORAGE_IMPLEMENTATION_PLAN.md`, and not resolved here:

| Ref | Open item |
|---|---|
| **STG-11** | Deep parsing, malware scanning and content disarm remain future hardening. Signature validation ≠ malware scanning ≠ safe internal document structure |
| **STG-14** | Orphan reconciliation remains future hardening; the process-crash window between object write and metadata commit persists |
| **D-7** | Superseded identity-document retention remains governed separately; current approved replacement behaviour is unchanged |
| **byteSize** | Computed at upload but **not persisted** — no column exists and none was added |
| **Audit purpose / case reference** | No column exists in `AdminAuditLog`; why a staff member opened a document is still uncaptured |
| **Audit-failure alerting** | Audit write failure is non-blocking and has no alert routing (depends on STG-22) |
| **Ride document storage** | `driver-document-storage.mjs` remains on the local filesystem, out of scope under the Ride restriction — **still carries this defect** |
| **Quebec document storage** | `quebec-document-storage.mjs` remains on the local filesystem under the Quebec freeze — **still carries this defect** |

Both out-of-scope modules require a separate owner decision.

*Numbering note:* this is the first ADR in the repository. `docs/architecture/` previously held flat
documents (`STR_EMAIL_VERIFICATION.md`, `STR_MONEY_MODEL.md`) with no ADR convention. Per owner
instruction, **ADR-0010 is reserved for this decision**, leaving 0001–0009 unallocated for earlier
decisions that may be recorded retrospectively.

## 3. Date

2026-07-22 (created) · 2026-07-22 (owner decision record appended — see §3a)

## 3a. Owner decision record — 2026-07-22

The owner approved this ADR as the architectural baseline and resolved four of the seven open decisions.
**Nothing in §4–§23 below has been rewritten.** Where a later decision changed earlier wording, the
change is marked with an explicit **[SUPERSEDED]** note at the point of change, and the original text is
left in place so the reasoning history stays readable.

| Ref | Decision | Resolution |
|---|---|---|
| **U1** | R2 data residency | **RESOLVED — European Union jurisdiction (`eu`), applied to all six buckets.** Automatic placement, `wnam`, `enam`, FedRAMP, and mixed EU/standard-placement bucket sets are all explicitly excluded |
| **U2** | Final bucket names | **RESOLVED — six owner-approved names using `production`** (not the earlier `prod` abbreviation). See the supersession note in §12 |
| **U3** | Staging environment | **RESOLVED — a real staging environment will exist**, with separate buckets, separate credentials, separate environment variables, no production data and no production tokens |
| **U7** | Bucket structure | **RESOLVED — six separate buckets** (media/documents × test/staging/production). A single shared bucket with environment prefixes remains rejected |
| **U4** | Credential injection | **RESOLVED — local shell or gitignored local env file for test; the deployment platform's encrypted environment store for staging and production.** Never committed, never printed, never in documentation, never `VITE_`-prefixed, never pasted into chat |
| **U5** | Cloudflare administration | **RESOLVED — platform owner as primary, one designated technical administrator as backup.** No shared generic administrator credentials; individual accounts where supported |
| **U6** | Credential rotation authority | **RESOLVED — platform owner and the designated technical administrator only.** Rotation must be documented; old credentials revoked only after the replacement is validated. **No automated rotation in this phase** |

**Endpoint model (single, EU).** All six buckets use the EU-jurisdiction endpoint form
`https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`
([Cloudflare — R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)).
**Phase 1 uses exactly one R2 endpoint class.** Because every bucket shares one jurisdiction, the
single `STORAGE_S3_ENDPOINT` variable defined in the configuration guide remains correct — the
per-bucket-class endpoint split that a mixed EU/standard layout would have required is **not needed**.

Account ID, endpoint, bucket names and credentials are all supplied as environment values. **None may be
hardcoded**, and none may carry a `VITE_` prefix.

**No Canada-specific residency is claimed.** Cloudflare R2 currently offers no Canadian jurisdiction and
no Canadian location hint; the only jurisdictions are `eu` and `fedramp`. Selecting the EU jurisdiction
is a technical infrastructure decision and is **not** a claim of Canadian data residency.

**Changing jurisdiction later requires a governed migration.** Jurisdiction is immutable after bucket
creation — Cloudflare: *"Once an R2 bucket is created, the jurisdiction cannot be changed."* A change
would require creating new buckets, copying every object (including identity documents, an auditable
operation), and updating the endpoint configuration. This is a governed migration, not a settings change.

**Explicitly not decided by this record.** The EU jurisdiction selection is a technical infrastructure
decision only. It is **not** a legal conclusion about GDPR applicability, Canadian privacy obligations,
Syrian privacy or data-localization requirements, international transfers, sanctions or export control,
or Cloudflare/Vercel eligibility to serve users located in Syria. Those remain separate launch gates,
tracked in `docs/product/SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md`.

## 4. Context

SYBNB accepts user-uploaded files across six subsystems, each with its own storage module in `server/lib/`:

| Module | Content | Sensitivity |
|---|---|---|
| `listing-media-storage.mjs` | Listing, accommodation and room-type photos | Public after listing approval |
| `id-document-storage.mjs` | Identity documents | Highly sensitive |
| `listing-document-storage.mjs` | Listing certificates (e.g. CITQ) | Private |
| `thread-document-storage.mjs` | Message-thread attachments | Private to participants |
| `driver-document-storage.mjs` | Driver licence / vehicle registration | Private |
| `quebec-document-storage.mjs` | Quebec onboarding documents | Private |

All six share one interface — `save*(base64, mime)`, `read*(key)`, `delete*(key)` — and all six currently
write to the local filesystem under `server/uploads/`.

The deployment target is Vercel serverless: `vercel.json` rewrites every `/api/*` request to
`api/index.mjs`, which delegates to the same `handleRequest()` used by the local dev server.

Two properties of the existing design are strong and are deliberately preserved by this decision:

1. **Files are never served directly.** Every read passes through an application route that authenticates,
   authorizes, and binds the storage key to its owning database row before returning bytes
   (`server/routes/listings.mjs`, `me.mjs`, `admin.mjs`, `driver.mjs`, `messages.mjs`,
   `quebec-driver-onboarding.mjs`).
2. **Object keys are already random.** Keys are `randomUUID()` plus an extension derived from a MIME
   allowlist — never the original filename, never a listing or user identifier.

This decision changes **where bytes live**. It does not change how access is authorized.

## 5. Problem statement

Local filesystem storage is not durable in the deployment target. On Vercel serverless the filesystem is
ephemeral and per-instance, which means:

- A photo written by instance A is not readable by instance B — the guest's image request 404s.
- Every file is lost on cold start, instance replacement, scaling, and deployment.
- An identity document uploaded for verification may be unavailable when an administrator opens the
  review queue, and an already-approved user's document cannot be re-examined.

The production configuration validator (`server/lib/env.mjs`) rigorously rejects a missing `AUTH_SECRET`,
`DATABASE_URL`, `CORS_ORIGIN`, Upstash Redis credentials, or mailer configuration — but has **no concept
of object storage**. Production therefore boots cleanly and then loses data silently.

Two consequences make this a launch blocker rather than technical debt:

- **Roadmap C2 ("real property photo upload") is marked COMPLETE but is non-functional in production.**
  The implementation is correct; the storage substrate is not.
- **Roadmap C5 (truthful host verification, committed `3f7d08e`) depends on identity documents
  persisting.** The verification chain it establishes cannot function in production without this ADR.

No existing test detects the defect, because the entire test suite runs against a real local disk. This
is why §19 makes a cross-instance durability test mandatory.

## 6. Decision

1. **Adopt Cloudflare R2** as the durable object store for all user-uploaded files.
2. **Use `@aws-sdk/client-s3`** as the client, against R2's S3-compatible API.
3. **Introduce one governed storage service** (`server/lib/object-storage.mjs`) with two drivers — `s3`
   for staging/production/verification, `local` for development and automated tests — selected by an
   **explicit** `STORAGE_DRIVER` environment variable, never inferred.
4. **Keep all six existing storage modules**, their names, signatures, validation, limits and error
   codes. They delegate only their three I/O operations to the storage service. **No upload or serve
   route changes.**
5. **All buckets are fully private.** No public access, no custom domain, no anonymous read policy.
6. **All delivery is through the existing application proxy routes**, for public media and private
   documents alike.
7. **No signed URLs in Phase 1.**
8. **No bucket CORS configuration.**
9. **No age-based object lifecycle deletion.** Only "abort incomplete multipart uploads after 1 day".
10. **Separate buckets per environment**, not shared buckets with environment prefixes.
11. **Least-privilege, bucket-scoped Object Read & Write tokens**, one per environment. No administrative
    R2 credentials in the application.
12. **Production and staging fail closed** on missing or invalid storage configuration. No silent
    fallback to local disk.
13. **No migration of existing local files, and no deletion of them.**

## 7. Alternatives considered

| Alternative | Verdict | Reasoning |
|---|---|---|
| **Local filesystem** (status quo) | **Rejected** | Ephemeral and instance-specific in the deployment target; not durable; unsuitable as a source of truth. This is the defect being fixed. **Retained only as an explicitly configured development/test adapter.** |
| **Database binary/blob storage** (Postgres `bytea` / large objects) | **Rejected** | Durable and transactional, which is genuinely attractive for the metadata-consistency problem. Rejected because it inflates database size and backup/restore time with data that never needs relational querying, degrades connection-pool behaviour under serverless when streaming multi-megabyte payloads, and makes the database the bottleneck for image delivery. Cost and operational profile are materially worse at photo volume. |
| **Cloudflare R2** | **Accepted** | See §B below. |
| **AWS S3** | **Rejected for now** | Functionally capable and the reference implementation of the API. Rejected primarily on egress cost, since the approved proxy architecture streams every byte through the application. Because the storage service abstracts the driver and R2 is accessed through the S3 API, **switching to S3 later is a configuration and endpoint change, not a rewrite.** |
| **Another S3-compatible store** (Backblaze B2, Wasabi, DigitalOcean Spaces) | **Deferred** | All viable. No reason to prefer one over R2 given the approved platform direction, and each adds a vendor relationship without a corresponding benefit. Remain available through the same abstraction. |
| **Vercel Blob** | **Deferred** | Tightest integration with the deployment platform and the least configuration. Rejected for Phase 1 because it is the least portable option — it has no S3-compatible API, so adopting it would couple the storage layer to the hosting provider and make a future migration a rewrite rather than a reconfiguration. |
| **Direct public bucket delivery** | **Rejected** | Would require public access or a custom domain on the media bucket. Removes the application's ability to distinguish an approved listing from a draft, exposing unpublished photos to anyone with a key. For the documents bucket it would be a severe data-protection failure. |
| **Signed URLs** | **Deferred to a future phase** | See §E below. |
| **Application proxy delivery** | **Accepted** | See §D below. |
| **Shared bucket with environment prefixes** | **Rejected** | See §H below. |
| **Separate buckets per environment** | **Accepted** | See §H below. |
| **MinIO for production-like verification** | **Rejected for that purpose** | Exercises the same S3 API and the same adapter code path, but is not the production provider — it would not surface R2-specific behaviour (endpoint semantics, auth, error shapes, consistency, latency). **Permitted purely as an optional offline developer convenience**; it does not satisfy §19. |

### A. Why local filesystem storage was rejected

Production runs in a serverless, multi-instance environment where local disk is **ephemeral**,
**instance-specific**, **not durable**, and therefore **unsuitable as the source of truth** for uploaded
media and documents. A file written during one request is not guaranteed to exist for the next.

The local adapter is retained **only** as an explicitly configured development and test driver, so that
`npm ci` plus a database remains sufficient to develop the project without a Cloudflare account.

### B. Why Cloudflare R2 was selected

Recorded without marketing claims:

- **S3-compatible API**, so it is driven by the standard client and standard semantics.
- **Compatible with `@aws-sdk/client-s3`**, the approved client library.
- **Supports fully private buckets** — public access is opt-in and stays off.
- **Suitable for proxied delivery**: the application holds a single service credential server-side and
  streams bytes; no per-user storage identity is required.
- **Portable through the storage abstraction**: because access is via the S3 API behind a driver
  interface, moving to another S3-compatible provider is a configuration change.
- **Aligned with the approved platform direction** (owner decision, 2026-07-22).
- **Egress is not separately billed** under Cloudflare's published R2 pricing, which is materially
  relevant because the proxy architecture streams every byte through the application. *Pricing terms
  should be confirmed against Cloudflare's current published terms at provisioning time; this ADR does
  not assert future pricing.*

### C. Why the bucket remains private

- No public bucket access and no public listing.
- No public identity-document URLs — no URL exists that returns a document without an authenticated,
  authorized request.
- **Application authorization remains mandatory** on every read.
- **Possession of an object key alone grants no access.** A key is not a capability: the serve routes
  independently verify the caller and bind the key to its owning database row.

The single highest-severity misconfiguration this ADR guards against is enabling public access or a
custom domain on the documents bucket, which would make every host and guest identity document
retrievable by anyone holding or guessing a key, with no authentication.

### D. Why application proxy delivery was selected

Phase 1 data flow, in both directions:

```
Upload:    Browser ──(base64 in JSON, same-origin)──▶ SYBNB API ──(server credential)──▶ R2
Download:  R2 ──(server credential)──▶ SYBNB API ──(authorized response)──▶ Browser
```

This **preserves the existing route authorization model exactly** — key-shape validation, row binding,
approved-versus-draft visibility, ownership and staff checks all remain where they are today and are not
reimplemented in a new place. It **avoids exposing direct bucket access** in any form.

The honest trade-off: bytes traverse the serverless function, consuming invocation time and forgoing CDN
caching. At closed-beta scale (5–10 hosts, 20–30 guests) this is not a meaningful cost, and correctness
is worth more than throughput at this stage.

### E. Why signed URLs were deferred

Signed URLs would reduce function invocation time and enable CDN caching for listing photos. They are
**deferred, not rejected**, and may be reconsidered later for performance or scale.

They are excluded from Phase 1 because they introduce a second, parallel access path that must
independently reproduce the visibility rules the proxy already enforces — and a mistake in that second
path is silent. For identity documents the position is stronger: a document should not have a URL that
functions outside an authenticated request, even briefly.

### F. Why bucket CORS is intentionally omitted

The browser never communicates directly with R2. Uploads are posted as base64 within a JSON body to the
SYBNB API; downloads are returned by the API's own file routes. Every browser request is same-origin with
the API.

Bucket CORS therefore has no effect and **must not be enabled**. Configuring it would signal that direct
browser-to-bucket access is intended, and would only become meaningful in combination with public access
or signed URLs — both out of scope.

**Application-level CORS is a separate concern and is unaffected.** It remains governed by
`server/index.mjs` and `server/lib/allowed-origins.mjs`.

### G. Why automatic age-based deletion is prohibited

**Application retention governance is authoritative.** `server/lib/listing-document-retention.mjs`
already implements document retention at the database level, including **legal hold**. Disputes, audit
requirements and document governance depend on that logic.

A bucket lifecycle rule deleting objects by age would operate with no knowledge of any of it — it could
**destroy bytes while a legal hold is in force**, or while a dispute or audit still requires them,
leaving the application holding a valid reference to data that no longer exists.

Only **"abort incomplete multipart uploads after 1 day"** is approved: it removes billable fragments of
uploads that never completed and can never be referenced by any database row.

Coordinating object lifecycle with the retention engine is listed as future evolution (§22). It is not
approved now.

### H. Why environments use separate buckets

Separate buckets give **stronger failure visibility** and **reduce the risk of silent cross-environment
writes**. A wrong bucket name fails immediately and loudly; a wrong key prefix inside a shared bucket
fails silently — test data lands among production objects, or a delete sweep crosses the boundary.

This mirrors the precedent already set by `server/lib/test-db-guard.mjs`, which refuses to let the test
suite connect to a non-test database rather than trusting convention.

### I. Why production fails closed

If production or staging storage configuration is missing or invalid:

- **Startup or the storage operation must fail clearly.**
- **No silent fallback to local disk** — a fallback would restore exactly the defect this ADR exists to
  fix, while appearing healthy.
- **No false upload-success response** — the application must never report a file as uploaded unless
  both the durable object write and the required metadata persistence have completed.

This follows the established pattern in `server/lib/env.mjs`, which already refuses to boot in production
without Upstash Redis rather than degrading silently to per-instance in-memory rate limiting.

### J. Why identifiers remain protected

- **Random object keys** — `randomUUID()` plus an allowlist-derived extension. Unchanged from today.
- **No original filename as durable identity.** A user-supplied filename is never used as, or embedded
  in, an object key, and is never echoed into a response header without sanitisation.
- **Masked private identifiers where applicable.** Storage keys, endpoints and bucket names must not
  appear in user-facing error messages. Error handling surfaces the failed operation and the bucket
  *class*, never the key, endpoint, or credential.
- **No secret values in logs**, stack traces, test output, screenshots, or documentation.
- **No `VITE_`-prefixed storage credentials.** Vite inlines `VITE_*` into the client bundle; such a
  variable would publish the credential to every visitor. This is prohibited without exception.

## 8. Consequences

**Positive**
- Uploaded files survive restarts, instance replacement, deployment and scaling.
- C2 becomes functional in production; the C5 verification chain becomes viable.
- The bucket is private by default, so the most severe failure mode requires a deliberate misconfiguration.
- No database migration and no change to route authorization, so the blast radius is small.
- The driver abstraction keeps provider choice reversible.

**Negative / accepted costs**
- Image bytes traverse the serverless function: more invocation time, no CDN caching. Accepted for
  Phase 1 at beta scale.
- A new external dependency and a new failure mode (storage provider unavailable) that must be handled
  explicitly rather than surfacing as a generic 500.
- Credential lifecycle to own: three tokens, rotation, and secure injection.
- Local development and the automated suite continue to run on a real disk, so they can never reproduce
  the ephemeral-filesystem class of defect — which is precisely why §19 exists.

**Neutral**
- Existing database values remain valid; keys and formats are unchanged.
- Existing local files are left in place, neither migrated nor deleted.

## 9. Security implications

- Buckets fully private; public access and custom domains disabled on all Phase 1 buckets.
- Application-layer authorization runs **before** any storage call, so a denied request cannot be used to
  probe object existence or generate storage cost.
- Least-privilege, bucket-scoped **Object Read & Write** tokens, one per environment. Administrative R2
  credentials are never used by the application — an application token that could enable public access
  would be a single-bug path to exposing every identity document.
- Compromise of the test token cannot reach staging or production.
- Object-key safety preserved: shape validation before every storage call; rejection of keys containing
  `/`, `..`, leading slashes, null bytes, or caller-supplied prefixes.
- **Magic-byte content sniffing to be added** — the declared MIME type must be verified against the
  decoded bytes, per the requirement not to trust browser-supplied MIME. This is a new control, not a
  preserved one.
- Existing 8 MB size limits and per-subsystem MIME allowlists preserved.
- No bucket-listing capability is reachable from any route.
- **Explicitly out of scope:** antivirus and malware scanning. None exists today and none is introduced here.

## 10. Privacy implications

- Identity documents are personal data of hosts and guests. They must be reachable only by the owning
  user and authorized staff, and only through an authenticated request.
- Private document responses retain `Cache-Control: private, no-store`.
- No public URL for any document exists in Phase 1, and no signed URL is issued.
- Verification and test activity uses synthetic data only; **real identity documents are never uploaded
  to a test or staging bucket**.
- Deletion and replacement must not leave stale private bytes retrievable through a superseded reference.
- Account deletion and retention flows continue to be governed by application logic; object lifecycle
  must not act independently of them (§G).

## 11. Data-residency implications

Identity documents belonging to Syrian hosts and guests will reside in the documents bucket. R2 bucket
location is determined at creation by a location hint or jurisdiction.

**This choice is effectively irreversible: changing it requires creating a new bucket and moving objects.**
It must therefore be made deliberately, before any bucket is created.

~~**This ADR does not select a jurisdiction.** No location has been approved by the owner, so none is
recorded here. It is carried as unresolved owner decision **U1** (§24).~~

**[SUPERSEDED 2026-07-22 — U1 RESOLVED]** The owner selected the **European Union jurisdiction (`eu`)**,
applied to **all six buckets**. The paragraph above is struck through rather than deleted, so the state
of knowledge at the time the ADR was accepted remains legible.

Basis for the choice, from
[Cloudflare — R2 data location](https://developers.cloudflare.com/r2/reference/data-location/):
a **jurisdiction** guarantees objects are stored within that jurisdiction, whereas a **location hint**
is best-effort placement only. Only `eu` and `fedramp` jurisdictions exist; there is no Canadian
jurisdiction and no Canadian location hint, so no Canada-aligned residency guarantee is available from R2
and none is claimed. `fedramp` is a United States government program restricted to Enterprise customers
and is not applicable.

Applying one jurisdiction to all six buckets keeps a single endpoint class in Phase 1 and makes the test
and staging environments exercise the same residency and latency behaviour as production.

Full comparison and sources: `docs/product/SYBNB_R2_DATA_RESIDENCY_OWNER_DECISION_BRIEF.md`.

## 12. Environment-isolation model

| Environment | Driver | Storage | Credentials | Isolation guarantee |
|---|---|---|---|---|
| Local development | `local` | `server/uploads/` | none | No network path to R2 |
| Automated tests | `local` | temporary directory | none | Guard rejects `s3` under `NODE_ENV=test` |
| Verification | `s3` | `sybnb-test-*` | test token | Token scoped to test buckets only |
| Staging | `s3` | `sybnb-staging-*` | staging token | Token scoped to staging buckets only |
| Production | `s3` | `sybnb-production-*` | production token | Token scoped to production buckets only |

**[SUPERSEDED 2026-07-22 — U2]** This ADR was originally drafted against the working names
`sybnb-prod-media` / `sybnb-prod-documents`. The owner approved **`sybnb-production-media`** and
**`sybnb-production-documents`**. The `prod` abbreviation must not be used in any new configuration.
Final approved set:

| Environment | Media bucket | Documents bucket |
|---|---|---|
| Test | `sybnb-test-media` | `sybnb-test-documents` |
| Staging | `sybnb-staging-media` | `sybnb-staging-documents` |
| Production | `sybnb-production-media` | `sybnb-production-documents` |

All six are created in the **EU jurisdiction** (§3a). If any approved name proves unavailable within the
Cloudflare account, the conflict is reported and work stops for owner approval — **no name is altered
silently**.

Required guards:

1. `NODE_ENV=production` with `STORAGE_DRIVER=local` → refuse to boot.
2. `NODE_ENV=production` with a bucket name containing `test`, `dev`, `staging` or `local` → refuse to boot.
3. `NODE_ENV=test` with `STORAGE_DRIVER=s3` → refuse to run, so a stray credential in a developer's shell
   can never let the suite write to a real bucket.
4. Automated tests never read `STORAGE_S3_*` variables.

## 13. Access-control model

Authorization is enforced **entirely in the application**. R2 performs no per-user authorization; it
recognises only the single service credential.

| Asset | Unauthenticated | Authenticated non-owner | Owner | Staff |
|---|---|---|---|---|
| Approved listing photo | Allow (via proxy) | Allow | Allow | Allow |
| Draft listing photo | Deny | Deny | Allow | Allow |
| Own identity document | Deny | Deny | Allow | Allow (ADMIN/SUPPORT) |
| Another user's identity document | Deny | Deny | n/a | Allow (ADMIN/SUPPORT) |
| Listing / thread / driver / Quebec document | Deny | Deny | Allow (owner/participant) | Allow |

**Ordering rule:** authenticate → authorize → resolve the key from the database row → fetch bytes. For
private documents the key is **never** taken from caller-supplied input; it is read from the row after
the ownership check.

## 14. Object-key model

Existing key identity is preserved: `randomUUID()` plus an extension derived from the MIME allowlist.

Namespaces applied **inside the storage service**, by bucket class:

```
media/listing/<uuid>.<ext>          documents/id/<uuid>.<ext>
media/accommodation/<uuid>.<ext>    documents/listing/<uuid>.<ext>
media/room-type/<uuid>.<ext>        documents/verification/<uuid>.<ext>
                                    documents/thread/<uuid>.<ext>
                                    documents/driver/<uuid>.<ext>
                                    documents/quebec/<uuid>.<ext>
```

The namespace is chosen by the calling module, never by the request.

## 15. Metadata model

The database remains the authoritative record of which object belongs to what.

| Field | Holds | Change |
|---|---|---|
| `User.idDocumentRef` | bare `<uuid>.<ext>` key | none |
| `ListingMedia.url` | application serve path containing the key | none |
| `ListingDocument.assetUrl` | bare key | none |
| `DriverDocument.assetUrl` | bare key | none |
| `ThreadDocument.assetUrl` | bare key | none |
| `QuebecDriverDocument.assetUrl`, `QuebecVehicleDocument.assetUrl` | bare key | none |

**No schema change and no data migration.** Because the stored value keeps its existing bare-key form and
the namespace prefix is applied inside the storage service, every existing row remains a valid reference.

**A temporary filesystem path is never persisted as a permanent reference.**

**Write ordering — object first, database second, cleanup third:**

- Object written and confirmed **before** any row is created or updated.
- If the database write then fails, the orphaned object is deleted and an error is returned.
- On replacement: write new object → update row → delete old object.
- On deletion: update/clear the row → delete the object. A failed object delete must not fail the
  request; it becomes an orphan, never a dangling reference.

Rationale: an orphaned object costs storage; a dangling database reference is a broken product surface
shown to a user. **The application must never report success unless both the durable write and the
metadata persistence have completed.**

## 16. CORS decision

**No bucket CORS configuration will be created.** See §F. Application-level CORS is separate and
unchanged. Revisit only if signed URLs or a public media domain are approved in a future phase, at which
point a narrow policy (specific origins, `GET`/`HEAD` only) must be designed deliberately.

## 17. Lifecycle and retention decision

**Approved:** abort incomplete multipart uploads after 1 day, on all buckets.

**Prohibited:** any age-based object deletion on media or document buckets. See §G — application
retention governance, legal hold, dispute and audit requirements remain authoritative, and a bucket rule
must not delete bytes the application still requires.

**Permitted on test buckets only:** a short expiry on `*-test-*` so verification artefacts do not
accumulate. Never applied to staging or production.

**Not a lifecycle rule:** orphan cleanup. An orphaned object is indistinguishable from a live object by
age; reconciliation against the database is required. Deferred (§22).

## 18. Failure and rollback strategy

**Failure handling — silent partial success is prohibited.**

| Failure | Behaviour |
|---|---|
| R2 unavailable | Explicit error; no database row created; no success reported |
| Object write fails | Error surfaced with the existing per-subsystem error code |
| Metadata write fails after object write | Delete the orphaned object; return an error |
| Object write fails after metadata write | Prevented by ordering — metadata is never written first |
| Read fails | Error distinguishing "not found" from "storage unavailable"; never a silent placeholder |
| Delete fails | Request still succeeds; object becomes an orphan; reference is already cleared |
| Replacement fails | Previous object and reference remain intact |
| Interrupted request | No row; any written object is an orphan, never a dangling reference |
| Invalid configuration | Fail closed at boot in production/staging (§I) |

**Rollback.** `STORAGE_DRIVER` is the switch; reverting to `local` restores the previous code path
immediately — but it also restores the defect, so it is an emergency measure valid for minutes, not days.

Safe properties: no database migration to reverse; key formats and stored values unchanged; objects
already in R2 are not destroyed and re-attach on roll-forward; module signatures unchanged so a code
revert is clean.

Unsafe property to understand first: **any file uploaded while the local driver is active will be lost**
at the next instance replacement. A rollback window is a data-loss window. Prefer rolling forward.

Triggers: failure of the cross-instance durability check, any authorization regression on the file
routes, or credential exposure.

On credential exposure: rotate the affected token in Cloudflare (invalidating the key pair), issue a
replacement with identical scope, update the environment store, redeploy. Per-environment scoping means
test-token exposure does not compromise production.

**Bucket-level rollback does not exist.** Object versioning is not enabled in Phase 1; a deletion is
final. This is a further reason objects are deleted only after the database row is updated.

## 19. Testing and production-like verification requirements

**Automated suite** (`local` driver, no credentials, no network): the existing 246 unit / 428 API / 21
security tests must pass unchanged, plus new coverage for explicit driver selection, production refusing
the local driver, object-key safety, UUID keys not derived from filenames, magic-byte sniffing, size and
MIME rejection, unauthorized upload, unauthorized private read, failed-metadata-write leaving no dangling
reference, replacement and deletion preserving privacy, and the test environment being unable to resolve
a production bucket.

**Mandatory production-like verification against a real R2 test bucket.** Local filesystem tests alone
are explicitly insufficient. Required scenario:

```
upload using one process/instance
   → persist metadata
   → retrieve using another process/instance (no shared local state)
   → restart the application
   → retrieve successfully again
```

**This cross-instance read is the test that would have detected the existing defect**, and it is the
single mandatory gate on the implementation checkpoint.

Also verified against real R2: public listing-photo route (approved and draft); private
identity-document route (owner and staff); authorization failures (guest → host document; host →
another host's document); replacement; deletion; missing object; storage provider unavailable.

MinIO does not satisfy this requirement (owner decision).

## 20. Migration implications

**No migration will be performed.**

Current local files: **2,791 files, ~11 MB** across the six directories (listing-media 1,301;
id-documents 787; quebec-documents 254; thread-documents 258; listing-documents 104; driver-documents 87).

`server/uploads/` is gitignored and **zero files are tracked in git**. No production deployment currently
exists. The volume and distribution — notably 787 identity documents — are consistent with accumulated
local development and repeated automated-test runs rather than real user data.

Per owner decision: **do not migrate, and do not delete.** Existing files remain in place. Because no
database values change, previously stored references stay syntactically valid; on the R2 driver they will
resolve only if the corresponding object exists in the bucket, which for these development artefacts it
will not. This is accepted.

If any of these files later prove to be real user data, a migration would be a separate plan with its own
audit and verification.

## 21. Operational ownership

| Responsibility | Owner | Status |
|---|---|---|
| Cloudflare account administration | **Unassigned** | Unresolved decision U5 |
| Bucket creation and settings | Owner / infrastructure | Pending |
| Credential rotation | **Unassigned** | Unresolved decision U6 |
| Environment variable management (Vercel) | Owner / infrastructure | Pending |
| Storage service code | Engineering | Pending implementation |
| Retention governance | Application (`listing-document-retention.mjs`) | Existing, authoritative |
| Incident response for exposure | **Unassigned** | Depends on U5/U6 |

**Recorded gap:** the platform has no monitoring or alerting (`SYBNB_FULL_PLATFORM_LAUNCH_READINESS_REVIEW.md`
§8). Storage failures will therefore be invisible until a user reports them. This ADR does not resolve
that; it is noted because introducing an external dependency raises the cost of having no observability.

## 22. Future evolution

Documented as possibilities only. **None is approved by this ADR.**

- Signed URLs for public media performance
- CDN and/or image transformations in front of the media bucket
- Responsive image variants generated at upload
- Malware scanning
- Content moderation of uploaded imagery
- Automated orphan cleanup via database reconciliation
- Coordination between the retention engine and object lifecycle
- Separate regional storage for data-residency requirements
- Direct multipart browser uploads for large files
- Division-specific buckets (e.g. SR) if divisions are separated
- Object versioning for accidental-deletion recovery

## 23. Explicit non-goals

- Changing the route authorization model
- Changing any database schema
- Migrating or deleting existing local files
- Public bucket access, custom domains, or signed URLs
- Bucket CORS
- Age-based object deletion
- Antivirus, malware scanning, or content moderation
- CDN, image transformation, or responsive variants
- Division isolation, fabricated-data removal, roadmap changes, or C4 availability enforcement — all
  separately gated
- Observability and backup/restore — real gaps, tracked separately
- Replacing MinIO's role for local convenience

## 24. Unresolved owner decisions

**All seven were resolved on 2026-07-22.** The original recommendation column is preserved unchanged so
the reasoning that led to each decision remains readable; the resolution column is the addition.

| # | Decision | Original recommendation (unchanged) | Resolution 2026-07-22 |
|---|---|---|---|
| **U1** | **R2 bucket location / data residency** | Choose deliberately based on where host and guest identity documents may lawfully reside for a Syria-first launch, and apply the same setting to test, staging and production document buckets. **No jurisdiction is selected in this ADR.** | **RESOLVED — EU jurisdiction (`eu`), all six buckets.** Automatic placement, `wnam`, `enam`, `fedramp` and mixed layouts excluded |
| **U2** | Final bucket names | `sybnb-{test,staging,prod}-{media,documents}` | **RESOLVED — `production` replaces `prod`.** See the supersession note in §12 |
| **U3** | Does a real staging environment exist now? | Create one — production-like verification and the closed beta both need it | **RESOLVED — staging will exist**, with separate buckets, credentials and variables; no production data or tokens |
| **U4** | Secure method for injecting test credentials | Enter directly into the local `.env` (gitignored) and the Vercel environment store. **Never** paste into chat, documents, tickets, or commits | **RESOLVED — as recommended.** Local shell or gitignored env file for test; encrypted platform store for staging/production |
| **U5** | Who owns Cloudflare account administration | A named individual with 2FA enabled; minimum set of accounts with R2 access | **RESOLVED — platform owner primary, one designated technical administrator as backup.** No shared generic administrator credentials |
| **U6** | Who can rotate storage credentials | Same named owner plus one documented backup, so rotation is possible during an incident if one person is unavailable | **RESOLVED — owner and designated technical administrator only.** Rotation documented; old credentials revoked after the replacement validates. No automated rotation this phase |
| **U7** | Six buckets as proposed, or another structure | Six (2 classes × 3 environments). The media/documents split reflects a genuine access-rule difference; the environment split prevents silent cross-environment writes | **RESOLVED — six buckets as proposed** |

### 24a. New open item — application runtime region

Not an original U-item; raised by the residency decision. Because the approved architecture proxies every
byte (`user → runtime → R2 → runtime → user`), the **application runtime region materially affects
latency**, and an EU-jurisdiction store paired with a North American runtime would leave the dominant leg
unimproved.

`vercel.json` contains **no `regions` key**, so the project uses Vercel's documented default of `iad1`
(Washington D.C.) unless a different default is set in the project dashboard — a setting not visible from
the repository and which must be checked directly.

**No region will be selected or changed without explicit owner approval.** Analysis and options:
`SYBNB_PERSISTENT_OBJECT_STORAGE_IMPLEMENTATION_PLAN.md` §14.

---

## Implementation gate

**Original gate (all four now satisfied or superseded):**

1. ~~The owner approves this ADR.~~ **Done — approved 2026-07-22.**
2. ~~The owner chooses the data-residency location (**U1**).~~ **Done — EU jurisdiction.**
3. The required R2 test bucket exists. — **Outstanding.**
4. Test credentials are injected securely into the environment. — **Outstanding.**

**Current gate — implementation is authorized only after the owner confirms all five:**

1. Test buckets exist **in the EU jurisdiction**.
2. Test credentials are securely injected.
3. Actual bucket names and the endpoint are confirmed.
4. No secret was entered into chat or committed.
5. **The implementation gate is explicitly reopened by the owner.**

Provisioning is performed **manually by the owner** — no Cloudflare resource is created by automation.
Checklist: `docs/product/SYBNB_R2_MANUAL_PROVISIONING_CHECKLIST.md`.

**Immediate provisioning scope is TEST only.** All six buckets may be created now, but **only test
credentials may be injected** until the staging and production gates are separately opened. Storage
testing uses **synthetic, non-personal files only** — never real passports, government IDs, host or guest
documents, or production property records.
