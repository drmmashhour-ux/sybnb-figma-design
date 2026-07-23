# STR Persistent Object Storage — Threat Model

**Date:** 2026-07-22
**Status:** Security design and verification document. **No code written, no dependencies installed, no cloud resources created.**
**Scope:** the approved STR persistent-object-storage architecture only.
**Companion documents:** `ADR-0010-PERSISTENT_OBJECT_STORAGE.md` · `SYBNB_PERSISTENT_OBJECT_STORAGE_IMPLEMENTATION_PLAN.md` · `SYBNB_R2_CONFIGURATION_GUIDE.md` · `SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md`
**Relationship to `SYBNB_V6_THREAT_MODEL.md`:** that document covers the platform (IDs `F-nn`). This one covers storage only and uses IDs `STG-nn`. Neither supersedes the other.

> **This is not a formal certification and does not claim that all risks are eliminated.** It is a
> practical STRIDE-style analysis extended with privacy, multi-tenancy, integrity, resilience, and
> retention/legal-hold threats. Residual risk is stated explicitly wherever it remains.

---

## 0. Owner decision record — 2026-07-22

**This threat model is ACCEPTED as the current security baseline, with the decision
"READY FOR TEST INFRASTRUCTURE PROVISIONING" approved.**

That approval authorizes **test infrastructure provisioning only**. It does **not** authorize storage
implementation, dependency installation, production provisioning, staging or production credential
injection, deployment, or public launch.

**The analysis in §1–§8 is unchanged.** The decisions below are recorded as annotations; where a
classification changed, the original wording is retained beside it.

| Ref | Decision | Effect on this document |
|---|---|---|
| **D-1** | **Runtime region — REMAINS OPEN.** No region recommended or changed; the database path must be established first | §7 "Vercel function region" and "Postgres region dependency" remain open. Investigation recorded in the implementation plan §14 |
| **D-2** | **Rate limiting — approved direction.** Private document routes become **fail-closed** with a truthful `503` when the limiter cannot be evaluated; public media gets a separate bounded, availability-aware policy | **STG-20 upgraded** — see the annotation on that entry. Exact rules in implementation plan §15 |
| **D-3** | **Evidence replacement — governance approved.** A worker may not silently overwrite submitted evidence | **STG-16 resolved in principle.** Storage-layer scope boundary defined in implementation plan §16 |
| **D-4** | **STG-12 and STG-24 — both APPROVED as required Phase 1 mitigations** | Both remain CLOSED-BETA BLOCKER; requirements detailed in implementation plan §17 |
| **D-5** | **Residual risks — NOT finally accepted.** Status: **PROVISIONALLY TOLERATED FOR TEST IMPLEMENTATION ONLY** | **The four ACCEPTED RESIDUAL RISK classifications in §8 are downgraded** — see the §8 annotation |

### Implementation outcome — Phases 1–3 complete (2026-07-22)

| Finding | Status after implementation |
|---|---|
| **STG-12** — inline rendering of private PDFs | ~~**CLOSED.**~~ **PARTIALLY CLOSED — 6 of 9 private-document routes.** The original wording is retained struck through above because it was wrong, not merely imprecise: forced download was implemented on the identity-document path only and recorded as closed for all class B/C responses. **Corrected 2026-07-23 under owner decision SYB-004 (Wave 0).** Full route-by-route status in *STG-12 — corrected implementation status* below |
| **STG-24** — staff document-view auditing | **CLOSED at the approved boundary.** Staff reads emit `STAFF_DOCUMENT_ACCESSED` via `server/lib/document-access-audit.mjs` recording actor, roles, entity reference, category, result and timestamp. Tested to contain no document bytes, storage key, bucket, endpoint or credential. Worker self-access is intentionally not audited. **Two gaps remain recorded:** no purpose/case-reference column exists, and audit failure is non-blocking with no alert routing (depends on STG-22) |
| **STG-11** — malicious upload content | **OPEN, unchanged.** Signature validation was added on both paths, but signature validation ≠ malware scanning ≠ deep structural validation ≠ safe document content. Deep parsing, antivirus, sandboxing and content disarm remain future hardening |
| **STG-14** — orphaned objects | **OPEN, unchanged.** Object→metadata ordering with cleanup on metadata failure is implemented, so a dangling reference is prevented; the process-crash window still orphans objects. Reconciliation remains future hardening |

#### STG-12 — corrected implementation status (2026-07-23)

**Why this correction exists.** This document recorded STG-12 as CLOSED on 2026-07-22 when
`privateDocumentDownloadHeaders()` had two call sites against nine routes that serve a stored private
document. The control was real, but the claim was general and the implementation was not. Independent
review raised it as **SYB-004 (Critical)**; live testing confirmed the exact split (**E2E-06**). The
error was in this document, not only in the code: a security record that overstates a control is worse
than a recorded gap, because it stops anyone looking.

**Current state — 6 of 9 routes forced to download.**

**1. Protected — identity-document paths** *(implemented 2026-07-22, Phase 3)*

| Route | File |
|---|---|
| `GET /api/me/id-document/file` | `server/routes/me.mjs:212` |
| `GET /api/admin/id-document/:userId/file` | `server/routes/admin.mjs:402` |

**2. Protected — remaining unfrozen private-document routes** *(implemented 2026-07-23, SYB-004 Wave 0)*

| Route | File |
|---|---|
| `GET /api/listings/:id/documents/:docId/file` | `server/routes/listings.mjs` |
| `GET /api/listings/:id/thread/documents/:docId/file` | `server/routes/messages.mjs` |
| `GET /api/admin/listing-documents/:docId/file` | `server/routes/admin.mjs` |
| `GET /api/admin/driver-documents/:docId/file` | `server/routes/admin.mjs` |

All six serve `Content-Disposition: attachment` with a server-derived filename built from a category
allowlist plus the stored MIME type — no code path admits caller input, the storage key, or a user id —
together with `nosniff`, `private, no-store` and `Content-Length`. Covered by
`test/api/private-document-forced-download.test.mjs` and `test/api/private-document-object-storage.test.mjs`.

**3. Still unprotected — frozen platform boundaries, intentionally deferred**

| Route | File | Boundary |
|---|---|---|
| driver document file | `server/routes/driver.mjs:314` | Ride |
| Québec onboarding document files (×2) | `server/routes/quebec-driver-onboarding.mjs:195, :441` | Québec |

These three **still render inline** and remain an **OPEN** part of STG-12. No boundary unfreeze was
authorized under SYB-004; changing them requires a separate Architecture Change Request and explicit
owner approval. They are additionally affected by the unrelated ephemeral-storage defect recorded below.

**Scope note.** `GET /api/admin/driver-documents/:id/file` is an *admin-surface* handler over
driver-domain data and was remediated because it lives in `server/routes/admin.mjs`, a Platform/Admin
module. The Ride module's own route (`driver.mjs`) was not touched. Because the helper's category
allowlist has no `driver` entry — and the helper is frozen — that route serves the generic
`sybnb-document.pdf` filename; the protection is the `attachment` disposition, not the label.

**Approved listing media** is deliberately excluded from forced download and is unaffected by this
correction.

**Related finding, not corrected here.** **STG-24** (staff document-view auditing) is recorded CLOSED in
the row above and is subject to the same class of overstatement. It is tracked separately as **SYB-005**
and is **undecided**; nothing in this correction alters it.

**Approved allowlists, enforced against both the declared MIME type and the actual file signature:**
media `image/jpeg` · `image/png` · `image/webp`; documents `application/pdf` · `image/jpeg` ·
`image/png`. WebP, GIF, SVG, HEIC, TIFF, ZIP, executables and office documents are rejected on the
document path and locked by regression test.

**Explicitly out of scope and still defective:** `driver-document-storage.mjs` and
`quebec-document-storage.mjs` remain on the local filesystem under the Ride restriction and the
Quebec freeze — they retain the original ephemeral-storage defect and need a separate owner decision.

---

**A new immutability finding emerged while investigating D-1** and is recorded in implementation plan §14:
a **Neon Postgres project's region cannot be changed after creation**, and the production database region
has never been chosen (`.env.production.example` carries an unfilled `REGION` placeholder). There are
therefore three regional decisions, two irreversible: R2 jurisdiction (decided — EU), **Neon region
(open, irreversible)**, and Vercel runtime region (open, reversible). **The Neon region should be decided
before the Vercel region.**

**Method:** STRIDE (Spoofing · Tampering · Repudiation · Information disclosure · Denial of service ·
Elevation of privilege), supplemented by privacy, multi-tenant authorization, data-integrity,
operational-resilience, and legal-hold/retention analysis.

**Architecture under analysis**

```
Upload:    Browser ──(base64 in JSON, same-origin)──▶ SYBNB API ──(server credential)──▶ private R2 bucket
Download:  private R2 bucket ──(server credential)──▶ SYBNB API ──(authorized response)──▶ Browser
```

Approved constraints treated as fixed: Cloudflare R2 · EU jurisdiction · six separate buckets
(media/documents × test/staging/production) · all private · no direct browser-to-R2 access · no bucket
CORS · no public bucket URLs · no signed URLs in Phase 1 · application-proxy authorization on every read ·
`@aws-sdk/client-s3` planned, not installed · no production fallback to local disk · local filesystem only
for isolated development and automated tests · application retention and legal-hold logic authoritative ·
no age-based document deletion · only incomplete-multipart cleanup · random object keys · original
filenames are not durable identifiers · database stores durable references and metadata · C5 commit
`3f7d08e` unchanged.

---

## 1. Scope

### 1.1 Assets

| Asset | Where it lives |
|---|---|
| Listing photos | `media` bucket · `ListingMedia.url` |
| Accommodation media | `media` bucket · `AccommodationMedia` |
| Room-type media | `media` bucket · `ListingMedia` |
| Host identity documents | `documents` bucket · `User.idDocumentRef` |
| Guest identity documents | `documents` bucket · `User.idDocumentRef` (same field, guest role) |
| Listing documents (e.g. CITQ) | `documents` bucket · `ListingDocument.assetUrl` |
| Verification evidence | `documents` bucket · thread/driver/Quebec document tables |
| Storage credentials | Environment store only — never in the repository |
| Object keys | Database columns; never a capability by themselves |
| Object metadata | `mimeType`, `submittedAt`, `status`, `version`, `isCurrent`, `replacesId` |
| Authorization decisions | Computed per request in `server/routes/*` |
| Audit records | `AdminAuditLog` |
| Retention / legal-hold state | `ListingDocument.legalHold`, `legalHoldReason`, `retentionDeleteAfter`, `deletedAt` |
| Upload and access logs | Currently ad-hoc; **no aggregation exists** (see STG-22) |

### 1.2 Actors

Unauthenticated visitor · authenticated guest · authenticated host · seller/listing owner · administrator ·
support agent · compromised user account · malicious insider · application runtime · database ·
Cloudflare R2 · deployment platform (Vercel) · automated tests · attacker controlling uploaded content.

### 1.3 Trust boundaries

1. Browser → API 2. Authentication → authorization 3. API → database 4. API → R2
5. Admin interface → protected documents 6. Test → staging 7. Staging → production
8. Environment-variable injection 9. Deployment platform → runtime 10. Retention engine → object deletion
11. Support access → private evidence.

### 1.4 Out of scope

General STR booking security unrelated to storage · payment processing · SR/Ride · a full
malware-analysis platform · production deployment · legal advice.

---

## 2. Data classification

| Class | Contents | Expected visibility | Authorized readers | Authorized writers | Retention sensitivity | Logging restrictions | Production/test restrictions |
|---|---|---|---|---|---|---|---|
| **A — Public / intended-public media** | Approved listing, accommodation and room-type photos | Public **only after listing `APPROVED`**; owner/admin while draft | Anyone (approved); owner + admin (draft) | Listing owner; admin | Low — lives as long as the listing | Object key may be logged at debug level; no personal data | Synthetic images only in tests |
| **B — Private operational documents** | Listing ownership/compliance documents, restricted property evidence | Never public | Document owner; ADMIN; SUPPORT | Owner; admin | **High** — governed by `listing-document-retention.mjs` incl. legal hold | Do not log full keys or filenames | Synthetic only |
| **C — Highly sensitive identity & verification data** | Identity documents, government-issued evidence, verification evidence | **Never public under any condition** | The owning user; ADMIN; SUPPORT (role-gated) | The owning user; ADMIN (on their behalf) | **Highest** | **Never** log key, filename, or subject identifier together | **Real documents must never be used in any test, at any tier** |
| **D — Secrets** | R2 access key id, R2 secret access key, deployment credentials | Never leaves the server environment | Runtime process only | Owner / designated technical administrator | n/a | **Never logged, never in errors, never in documentation** | Test credentials are scoped to test buckets and are the least-trusted tier |

**Explicit rule:** a document is **not** class A merely because an API route can return it. Class A is
determined by *intended audience*, not by *reachability*. Approved listing photos are class A; everything
served through an authenticated route is class B or C.

---

## 3. Threat register

**Severity scale** (aligned with `SYBNB_V6_THREAT_MODEL.md`): Critical · High · Medium · Low · Informational.
**Launch classification:** CLOSED-BETA BLOCKER · PUBLIC-LAUNCH BLOCKER · HIGH-PRIORITY FOLLOW-UP ·
ACCEPTED RESIDUAL RISK · FUTURE HARDENING.

---

### STG-01 — Broken object-level authorization (cross-tenant private read)
**Category** Elevation of privilege / multi-tenant isolation · **Asset** Class C, B · **Actor** Authenticated host or guest; compromised account
**Entry point** `GET /api/me/id-document/file`, `GET /api/admin/id-document/:userId/file`, listing-document routes · **Boundary** Authentication → authorization
**Preconditions** Attacker holds a valid session for any account.
**Scenario** Host A attempts to read Host B's identity document by manipulating the user id or document reference in the request path.
**Impact** Disclosure of government identity documents — the highest-severity outcome in this model.
**Existing mitigation** `/api/me/id-document/file` resolves the key from `context.user.idDocumentRef` — the caller's own row — so no caller-supplied identifier participates. The admin route requires an ADMIN/SUPPORT role. Both are covered by passing tests in `test/api/verification-states.test.mjs` (cross-account read → 404; non-admin on the admin route → 403).
**Required Phase 1 mitigation** Preserve this exactly. The storage migration must not introduce any path where a key is accepted from the request for a class B/C read.
**Required test** Guest → host document denied; host A → host B denied; non-admin → admin route denied; deactivated user denied.
**Residual risk** Low — a future route that accepts a document key as a parameter would reintroduce this. Guarded by test, not by type system.
**Severity** Critical · **Likelihood** Low · **Priority** P1 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-02 — Stale ownership after listing transfer or role change
**Category** Elevation of privilege · **Asset** Class A (draft), B · **Actor** Former owner; deactivated user
**Entry point** Media and listing-document serve routes · **Boundary** Authentication → authorization
**Preconditions** Listing ownership changes, a role is revoked, or an account is deactivated while a session remains valid.
**Scenario** A former owner retains read access to draft media or listing documents because authorization consults a cached or stale ownership value.
**Impact** Unauthorized access to another party's unpublished or private material.
**Existing mitigation** Authorization reads ownership from the database per request; there is no ownership cache.
**Required Phase 1 mitigation** Keep per-request database resolution. Explicitly confirm that a deactivated user (`status != 'ACTIVE'`) is rejected before any storage call.
**Required test** Ownership transfer → previous owner denied using current state; deactivated user denied.
**Residual risk** Medium — session invalidation on role change is a broader platform concern (roadmap H7) and is **not** solved by this item.
**Severity** High · **Likelihood** Medium · **Priority** P1 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-03 — Object-key enumeration and key-as-credential
**Category** Information disclosure · **Asset** All object classes · **Actor** Unauthenticated visitor; authenticated non-owner
**Entry point** Any file-serve route · **Boundary** Browser → API
**Preconditions** Attacker obtains or guesses an object key.
**Scenario** A leaked key from a log, screenshot, or referrer is replayed directly against a serve route.
**Impact** Disclosure if keys alone granted access.
**Existing mitigation** Keys are `randomUUID()` v4 — not sequential, not derived from any identifier. `STORAGE_KEY_RE` re-validates shape before any I/O. Critically, the media route **binds the key to its row**: a `ListingMedia` row must exist whose `url` is exactly this listing's serve path for this key, so a key from another listing fails. Class C reads never accept a caller-supplied key at all.
**Required Phase 1 mitigation** Preserve key randomness, shape validation, and row binding in the R2 adapter. **Invariant 1 must hold: possession of a key never grants access by itself.**
**Required test** Valid key from listing X rejected on listing Y; malformed key rejected; unauthenticated read denied before any storage call.
**Residual risk** Low.
**Severity** High · **Likelihood** Low · **Priority** P1 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-04 — Verbose errors confirming object existence
**Category** Information disclosure · **Asset** Class B, C · **Actor** Authenticated non-owner
**Entry point** File-serve routes · **Boundary** Browser → API
**Scenario** Distinct responses for "exists but forbidden" versus "does not exist" let an attacker enumerate which users have submitted identity documents.
**Impact** Metadata leak about who is under verification.
**Existing mitigation** Partial — the cross-account test asserts `404 ID_DOCUMENT_NOT_FOUND` rather than 403 for a non-owner, which is the desired shape.
**Required Phase 1 mitigation** Ensure the R2 adapter does not change this: a storage-level "no such key" must not produce a different externally visible status than an authorization denial for class C. Never surface bucket name, endpoint, or account id in a client-facing error.
**Required test** Non-owner and non-existent produce indistinguishable client-visible responses for class C.
**Residual risk** Low.
**Severity** Medium · **Likelihood** Medium · **Priority** P2 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-05 — Bucket misconfiguration (public access / custom domain / CORS)
**Category** Information disclosure · **Asset** All, especially class C · **Actor** Administrator (error); malicious insider
**Entry point** Cloudflare dashboard · **Boundary** Deployment platform → runtime
**Preconditions** Someone enables `r2.dev` public access or attaches a custom domain.
**Scenario** `sybnb-production-documents` is made public; every identity document becomes retrievable by key with no authentication, bypassing every application control in this document.
**Impact** **Catastrophic** — mass disclosure of government identity documents.
**Existing mitigation** R2 buckets are private by default ("will always require explicit user permission to enable"). Provisioning checklist items 4–6 require explicit verification per bucket.
**Required Phase 1 mitigation** Checklist verification; application tokens limited to **Object Read & Write** so the application itself cannot enable public access.
**Required test** Not automatable from the application. **Manual verification per bucket, recorded**, plus a post-deployment check that an unauthenticated request directly to the R2 endpoint is refused.
**Residual risk** **Medium and irreducible in Phase 1** — this is a dashboard setting with no application-side guard and no monitoring to detect a later change. This is the single most dangerous residual risk in this model.
**Severity** Critical · **Likelihood** Low · **Priority** P1 · **Owner** Owner / technical administrator · **Classification** CLOSED-BETA BLOCKER (verification) + PUBLIC-LAUNCH BLOCKER (ongoing detection)

### STG-06 — Overly broad or misassigned credentials
**Category** Elevation of privilege · **Asset** Class D · **Actor** Administrator (error)
**Scenario** An account-wide or Admin-scoped token is used by the application; a compromise then permits bucket configuration changes, including enabling public access, or cross-environment writes.
**Impact** Escalation from application compromise to full storage compromise.
**Existing mitigation** None yet — no tokens exist.
**Required Phase 1 mitigation** Three separate **Object Read & Write** tokens, each scoped to its own two buckets; no administrative token in the application; expiry on the test token.
**Required test** Manual verification at provisioning (checklist items 9–11).
**Residual risk** Low once verified.
**Severity** High · **Likelihood** Low · **Priority** P1 · **Owner** Owner · **Classification** CLOSED-BETA BLOCKER

### STG-07 — Credential leakage
**Category** Information disclosure · **Asset** Class D · **Actor** Any with repository, log, or bundle access
**Entry point** Repository, build output, logs, error responses
**Scenario** A secret is committed, printed in an error, or — worst case — added with a `VITE_` prefix and inlined into the client bundle, publishing it to every visitor.
**Impact** Full read/write access to the affected bucket class.
**Existing mitigation** `.env*` is gitignored; the existing codebase has no storage credentials; documentation uses placeholders only.
**Required Phase 1 mitigation** Prohibit `VITE_`-prefixed storage variables; ensure error handling surfaces the failed operation and bucket *class* only — never key id, secret, endpoint, or account id; keep secrets out of test fixtures.
**Required test** Build output greps clean for any storage variable name; error-path test asserts no credential substring in the response or log line.
**Residual risk** Low.
**Severity** Critical · **Likelihood** Low · **Priority** P1 · **Owner** Engineering + Owner · **Classification** CLOSED-BETA BLOCKER

### STG-08 — Stale credentials not revoked after rotation
**Category** Elevation of privilege · **Asset** Class D · **Actor** Former administrator; attacker holding an old key
**Scenario** A credential is rotated but the previous one is never revoked, leaving a valid path into the bucket.
**Existing mitigation** None — no rotation has occurred.
**Required Phase 1 mitigation** Documented rotation with revocation **after** the replacement validates; rotation authority limited to the owner and the designated technical administrator.
**Required test** Manual; rotation procedure must be **exercised at least once before public launch**, not merely written.
**Residual risk** Medium until exercised.
**Severity** High · **Likelihood** Low · **Priority** P2 · **Owner** Owner · **Classification** PUBLIC-LAUNCH BLOCKER

### STG-09 — Cross-environment contamination
**Category** Tampering / information disclosure · **Asset** All · **Actor** Automated tests; developer; misconfiguration
**Entry point** Environment variables · **Boundary** Test → staging → production
**Scenario** A stray credential in a developer shell lets the test suite write to — or delete from — a production bucket; or production is configured with a test bucket name and silently serves nothing.
**Impact** Production data loss or contamination; test data appearing as real inventory.
**Existing mitigation** Precedent exists: `server/lib/test-db-guard.mjs` already refuses to let the suite touch a non-test database.
**Required Phase 1 mitigation** Separate buckets per environment (not prefixes); `NODE_ENV=test` + `STORAGE_DRIVER=s3` → refuse to run; production rejects bucket names containing `test`/`dev`/`staging`/`local`; tests never read `STORAGE_S3_*`.
**Required test** Test env cannot resolve a production bucket; production refuses a test-named bucket; production refuses the local driver.
**Residual risk** Low.
**Severity** High · **Likelihood** Medium · **Priority** P1 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-10 — Silent fallback to local disk in production
**Category** Denial of service / integrity · **Asset** All · **Actor** Misconfiguration
**Scenario** Storage configuration is missing in production and the application quietly uses the local driver — reintroducing exactly the ephemeral-filesystem defect this whole workstream exists to fix, while appearing healthy.
**Impact** Silent, ongoing data loss; uploads reported successful then lost at the next instance replacement.
**Existing mitigation** Pattern precedent in `server/lib/env.mjs` (production refuses to boot without Upstash Redis).
**Required Phase 1 mitigation** `validateProductionConfig()` must reject `STORAGE_DRIVER != 's3'` and any missing endpoint/credential/bucket value. **Fail closed at boot.**
**Required test** Production + local driver → refuses to boot; each missing variable → refuses to boot.
**Residual risk** Low.
**Severity** Critical · **Likelihood** Medium · **Priority** P1 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-11 — Malicious upload content
**Category** Tampering / elevation of privilege · **Asset** Class A, B, C · **Actor** Attacker controlling uploaded content
**Entry point** All upload routes · **Boundary** Browser → API
**Scenario** MIME spoofing (a PDF declared `image/png`), polyglot files, executable content, decompression bombs, malformed images, hostile filenames, metadata injection.
**Existing mitigation — stronger than it may appear:**
- **SVG is not accepted anywhere.** Media allows only `image/jpeg`, `image/png`, `image/webp`; documents allow only `image/jpeg`, `image/png`, `application/pdf`. **SVG script content is structurally excluded**, not merely filtered.
- 8 MB ceiling on every subsystem, enforced on the **decoded** buffer.
- Extension is derived from the allowlist, never from the filename.
- `x-content-type-options: nosniff` and `content-security-policy: default-src 'none'; frame-ancestors 'none'` on every API response, including file serves.
**Required Phase 1 mitigation** **Add magic-byte sniffing** — verify the decoded bytes' signature against the declared MIME (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`, PDF `%PDF`) and reject on mismatch. This is the approved response to "do not rely only on the browser-provided MIME type".
**Required test** Declared/actual mismatch rejected; oversized rejected; unsupported type rejected; hostile filename does not influence the object key.
**Residual risk** **Medium and explicitly accepted.** Phase 1 performs **no malware scanning and no deep content parsing**. A malicious-but-well-formed PDF or image that passes signature and size checks is stored. Decompression bombs are bounded by the 8 MB limit but not otherwise analysed. Malware scanning is FUTURE HARDENING and is **not** approved for Phase 1.
**Severity** Medium · **Likelihood** Medium · **Priority** P2 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER (validation) + FUTURE HARDENING (scanning)

### STG-12 — Inline rendering of private PDFs
**Category** Information disclosure / tampering · **Asset** Class B, C · **Actor** Attacker controlling uploaded content
**Entry point** `GET /api/me/id-document/file`, admin document routes
**Scenario** PDFs are an accepted document type and are served with `content-type: application/pdf` and **no `Content-Disposition` header** (confirmed: the only `content-disposition` in `server/routes/` is on an unrelated admin CSV export). The document therefore renders **inline, same-origin**, in the reviewer's browser.
**Impact** A hostile PDF is rendered in an administrator's authenticated session context rather than downloaded. Practical exploitability is materially reduced by `default-src 'none'` and `nosniff`, but CSP enforcement inside built-in PDF viewers is browser-dependent, so this should not be relied upon alone.
**Existing mitigation** Strict CSP and `nosniff` on every response; `Cache-Control: private, no-store` on identity-document responses.
**Required Phase 1 mitigation** Add `Content-Disposition: attachment` (with a sanitised, non-user-controlled filename) to **all class B and C** file responses. Small change, meaningful defence-in-depth, and it belongs with this work because the serve path is being touched.
**Required test** Class B/C responses carry `Content-Disposition: attachment`; the filename is not attacker-controlled.
**Residual risk** Low after mitigation.
**Severity** Medium · **Likelihood** Low · **Priority** P2 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER
*Note: this is a **pre-existing** condition, not introduced by the R2 migration. It is recorded here because this workstream is the right time to fix it.*
**Status (2026-07-23): PARTIALLY CLOSED — 6 of 9 routes.** The three frozen Ride/Québec routes still
render inline. See *STG-12 — corrected implementation status* near the top of this document. The
"Required Phase 1 mitigation" above — forced download on **all** class B/C responses — is therefore
**not yet fully met**.

### STG-13 — Partial failure between object write and metadata write
**Category** Integrity · **Asset** All · **Actor** Application runtime; network
**Scenario** Object write succeeds and the database write fails (orphan), or the reverse (dangling reference). A dangling reference is the worse outcome: a user is shown a photo or document that does not exist.
**Existing mitigation** The current `me.mjs` ID-document flow already orders correctly: save object → update row → delete the superseded object.
**Required Phase 1 mitigation** Enforce **object first, database second, cleanup third** across all six modules. On database failure after a successful object write, delete the orphan and return an error. **Never report success unless both completed** (invariants 9 and 10).
**Required test** Simulated metadata failure leaves no successful record and no dangling reference; simulated object failure creates no row.
**Residual risk** Low for dangling references; orphans remain possible (STG-14).
**Severity** High · **Likelihood** Medium · **Priority** P1 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-14 — Orphaned objects
**Category** Privacy / cost · **Asset** Class B, C · **Actor** Interrupted request
**Scenario** Bytes are written, the request aborts before commit, and the object persists with no database reference — including, potentially, an identity document with no owner record and therefore outside every retention and deletion path.
**Impact** Personal data retained indefinitely and invisibly; storage cost; a data-subject-deletion request cannot reach it.
**Existing mitigation** Write ordering limits the window.
**Required Phase 1 mitigation** None beyond ordering. **Automated orphan cleanup is explicitly deferred** — an orphan is indistinguishable from a live object by age alone, so a lifecycle rule cannot be used safely (it would risk deleting live objects, and could conflict with legal hold).
**Required test** Interrupted upload produces no success record. Orphan detection itself is not tested in Phase 1.
**Residual risk** **Medium — ACCEPTED for Phase 1 with explicit rationale:** at closed-beta volume the expected orphan count is very low; the alternative (an age-based lifecycle rule) is more dangerous than the problem, because it could delete live or legally-held objects. Revisit before public launch via database reconciliation, not lifecycle rules.
**Severity** Medium · **Likelihood** Medium · **Priority** P3 · **Owner** Engineering · **Classification** ACCEPTED RESIDUAL RISK → HIGH-PRIORITY FOLLOW-UP before public launch

### STG-15 — Replacement exposing a stale private object
**Category** Information disclosure · **Asset** Class B, C · **Actor** Any holder of a previous key
**Scenario** A rejected identity document is replaced; the old object is not deleted, or deletion fails silently, leaving superseded personal data retrievable.
**Existing mitigation** `me.mjs` deletes the previous object when the reference changes.
**Required Phase 1 mitigation** Preserve this in the adapter; a failed delete must be **observable**, not swallowed. Concurrent replacements must not leave two live objects both believed current.
**Required test** Replacement removes the prior object; the prior key no longer resolves; concurrent replacement is safe.
**Residual risk** Low; a failed delete degrades to STG-14.
**Severity** High · **Likelihood** Low · **Priority** P1 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-16 — Unauthorized deletion or replacement
**Category** Tampering / repudiation · **Asset** Class A, B, C · **Actor** Host under review; support agent; attacker with a session
**Scenario** A host deletes or replaces evidence currently under admin review; an attacker replaces an approved listing photo; a stale delete request removes a newer object after a replacement.
**Impact** Destruction of evidence; misrepresentation of a listing; loss of audit trail.
**Existing mitigation** Routes require ownership or role; `AdminAuditLog` records admin decisions; `ListingDocument` carries `version`, `isCurrent`, `replacesId`.
**Required Phase 1 mitigation** Deletion and replacement must consult **current** state and must honour legal hold (STG-17). A delete request must target a specific version/key, so a stale request cannot remove a newer object.
**Required test** Non-owner deletion denied; deletion under legal hold denied; stale delete does not affect a newer object.
**Residual risk** ~~Medium — whether a host should be able to replace evidence *while under review* is a product rule that is not yet defined.~~ **[D-3 2026-07-22 — RESOLVED IN PRINCIPLE]** Governance approved: **a worker may not silently overwrite evidence after it has been submitted for review.** The approved lifecycle (Draft → Submitted → Under review → Replacement requested → New evidence submitted → Prior evidence retained per retention/audit rules → Reviewer evaluates current version) must preserve prior object reference, timestamps, actor, reason, review state, audit trail and legal-hold state; and must never erase review history, silently change an approved record, bypass correction-required, delete under legal hold, or expose the prior private object.
**Storage-item boundary:** only the *safe replacement semantics* are in scope here — ordered replacement, legal-hold check before deletion, superseded object not retrievable, concurrent-replacement safety, version-targeted deletes. The **state machine, the block-while-under-review product rule, replacement reasons, version-history UI, and superseded-document retention are OUT of scope** and tracked separately (implementation plan §16).
**Open tension recorded:** `me.mjs` currently **deletes** the previous identity document on replacement — a deliberate privacy choice that conflicts with "prior object reference retained where retention permits". **The storage item does not change this behaviour; the owner must resolve the conflict before the retention rule is built.**
**Severity** High · **Likelihood** Medium · **Priority** P1 · **Owner** Engineering + Product · **Classification** CLOSED-BETA BLOCKER (storage-layer semantics only)

### STG-17 — Retention and legal-hold violation
**Category** Integrity / compliance · **Asset** Class B, C · **Actor** Bucket lifecycle; application deletion path
**Scenario** A bucket lifecycle rule deletes bytes while `legalHold` is set; or the application deletes bytes while the database still requires them for a dispute or audit; or legal-hold state is lost during a future migration.
**Impact** Destruction of evidence required for a dispute, audit, or legal obligation — potentially irreversible.
**Existing mitigation** `server/lib/listing-document-retention.mjs` implements retention with `legalHold`, `legalHoldReason`, `retentionDeleteAfter`, `deletedAt`. Architecturally, **only incomplete-multipart cleanup is approved**; age-based object deletion is prohibited precisely to prevent this.
**Required Phase 1 mitigation** Provisioning must confirm no age-based lifecycle rule on any media or documents bucket. The deletion path must check legal-hold state **before** issuing an object delete. **Invariant 17: object-store lifecycle can never override an application legal hold.**
**Required test** Deletion under legal hold denied; retention logic remains authoritative; a lifecycle rule is absent (manual verification).
**Residual risk** Low, provided the checklist is followed. There is no application-side guard against someone adding a lifecycle rule later — see STG-05, same shape of risk.
**Severity** High · **Likelihood** Low · **Priority** P1 · **Owner** Engineering + Owner · **Classification** CLOSED-BETA BLOCKER

### STG-18 — Sensitive logging
**Category** Information disclosure / privacy · **Asset** Class C, D · **Actor** Anyone with log access
**Scenario** Logs or error traces contain credentials, full object keys for identity documents, personal filenames, bucket names, account id, or signed request headers — correlating a named user with their identity document.
**Existing mitigation** No structured logging exists today, which incidentally limits exposure but is itself a gap (STG-22).
**Required Phase 1 mitigation** Storage errors surface the operation and bucket *class* only. Never log: secrets, class C object keys, original filenames, endpoint, account id. When a key must be logged for debugging, truncate it.
**Required test** Error-path assertions that no credential and no full class C key appears in the response or emitted log line.
**Residual risk** Medium — grows when real logging is introduced. Whoever adds observability must re-check this.
**Severity** High · **Likelihood** Medium · **Priority** P2 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-19 — SSRF via configurable storage endpoint
**Category** Elevation of privilege · **Asset** Class D and internal network · **Actor** Attacker with configuration influence
**Scenario** If the storage endpoint were derived from user input or an unvalidated source, the server could be induced to send credentialed requests to an attacker-controlled host — leaking the credential in the process.
**Existing mitigation** By design the endpoint is environment-controlled only; no route accepts an endpoint, bucket name, or account id from a request.
**Required Phase 1 mitigation** **No user input may ever influence the endpoint, bucket, or credential.** Validate at boot that the endpoint matches the expected R2 form (`https://<account>.eu.r2.cloudflarestorage.com`) and refuse to start otherwise. Do not follow cross-host redirects from the storage client.
**Required test** No route accepts an endpoint parameter; an unexpected endpoint form fails configuration validation; credentials are never sent to an unapproved host.
**Residual risk** Low.
**Severity** High · **Likelihood** Very low · **Priority** P2 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-20 — Download abuse and proxy resource exhaustion
**Category** Denial of service / cost · **Asset** Class A; application availability · **Actor** Unauthenticated visitor; scraper
**Scenario** Because every byte is proxied through the serverless function, repeated large downloads consume invocation time and budget. Repeated missing-object probes and range-request abuse add load. Approved listing photos are publicly reachable by design, so scraping is possible.
**Impact** Cost amplification; degraded availability.
**Existing mitigation** `DOCUMENT_ACCESS` rate limit (30/min, per user); `PUBLIC_SEARCH` (60/min). **Important caveat: `DOCUMENT_ACCESS` is configured `failMode: 'open'`** — if the Redis store is unavailable, document access becomes unlimited.
**Required Phase 1 mitigation** None mandatory beyond existing limits at beta scale. **Confirm whether the public media route is rate-limited at all** — it is not currently named in the limiter rules, and it becomes the highest-volume proxied path.
**Required test** Rate limit enforced on document access; behaviour under storage unavailability is truthful (STG-21).
**Residual risk** ~~Medium — accepted for closed beta.~~ **[D-2 2026-07-22 — SUPERSEDED]** The owner approved explicit controls rather than acceptance:
> **Private document routes become fail-closed.** When the limiter dependency cannot be evaluated, respond with a truthful temporary-unavailable (`503` + `Retry-After`) — never `429`, and **never the object**. A private document is not released merely because Redis is unavailable.
> **Public media gets a separate bounded policy**, deliberately *not* globally fail-closed (that would turn a limiter outage into a site outage for intentionally public content). Per-IP rate **plus a per-window byte budget** (bytes, not requests, are the real cost under the proxy model), a local in-process ceiling that still applies when the shared store is down, a tighter limit on missing-object responses, and bounded range requests. Draft media follows the private policy.
Exact rules: implementation plan §15. Not implemented.
**Severity** Medium · **Likelihood** Low (beta) / High (public) · **Priority** **P1** · **Owner** Engineering · **Classification** **CLOSED-BETA BLOCKER** (private fail-closed behaviour) + PUBLIC-LAUNCH BLOCKER (public-media policy)
*Was: ACCEPTED RESIDUAL RISK (beta) → PUBLIC-LAUNCH BLOCKER. Upgraded by D-2.*

### STG-21 — Integrity and authenticity of stored objects
**Category** Tampering · **Asset** All · **Actor** Storage provider; malicious insider; key collision
**Scenario** Object bytes change outside the application; metadata no longer matches bytes; the wrong object is returned for a database reference; an accidental overwrite occurs on key collision.
**Existing mitigation** UUIDv4 keys make collision negligible; content-type is derived from the key extension rather than caller-supplied; row binding ensures the key belongs to the referenced resource.
**Required Phase 1 mitigation** Writes must not overwrite an existing key (a new UUID is generated per upload, so overwrite implies a bug). Consider recording object size at upload so an obviously wrong response is detectable.
**Required test** Key collision cannot overwrite another object; the object returned matches the reference; MIME metadata matches the stored bytes.
**Residual risk** **Medium — accepted.** Phase 1 stores **no content hash**, so silent byte-level modification is not detectable. Checksums are FUTURE HARDENING.
**Severity** Medium · **Likelihood** Low · **Priority** P3 · **Owner** Engineering · **Classification** ACCEPTED RESIDUAL RISK

### STG-22 — No monitoring or alerting
**Category** Repudiation / operational resilience · **Asset** All · **Actor** n/a (systemic gap)
**Scenario** Upload failures, read failures, authorization-denial spikes, unexpected deletions, missing objects, cross-environment configuration errors, credential failures and R2 outages are all **invisible** until a user reports them.
**Impact** A storage misconfiguration or an active attack could run indefinitely without detection. This directly weakens STG-05, STG-09 and STG-18, each of which relies on someone noticing.
**Existing mitigation** **None.** No Sentry, no structured logging, no alerting anywhere in the platform.
**Required Phase 1 mitigation** None implemented (monitoring is explicitly out of scope for this item). **Requirement recorded:** the minimum signals are upload failure rate, read failure rate, authorization-denial spikes, unexpected deletion, missing object, cross-environment configuration error, credential failure, and R2 availability.
**Required test** n/a in Phase 1.
**Residual risk** **High — accepted for closed beta only**, on the explicit basis that beta scale permits manual observation by a small operator team. **This is not acceptable at public scale.**
**Severity** High · **Likelihood** Certain · **Priority** P1 (public) · **Owner** Engineering + Owner · **Classification** PUBLIC-LAUNCH BLOCKER

### STG-23 — Backup, restore and disaster recovery
**Category** Operational resilience · **Asset** All · **Actor** n/a
**Scenario** The database is restored to a point in time without matching objects (dangling references), or objects exist without metadata (orphans at scale). A deleted object is needed during a dispute. No restoration has ever been tested.
**Impact** Unrecoverable inconsistency between the two stores; inability to produce evidence in a dispute.
**Existing mitigation** **None** — no documented backup or restore procedure exists for either store.
**Required Phase 1 mitigation** None implemented. **Recorded requirement:** object storage and database backups must have a coordinated point-in-time story, and a restore must be **rehearsed**, not merely documented. Note that R2 object versioning is **not** enabled, so a deletion is final.
**Required test** Restore rehearsal before public launch.
**Residual risk** **High — accepted for closed beta**, on the basis that beta data is low-volume and recreatable. Not acceptable at public scale.
**Severity** High · **Likelihood** Medium · **Priority** P1 (public) · **Owner** Owner + Engineering · **Classification** PUBLIC-LAUNCH BLOCKER

### STG-24 — Insider and support misuse; cross-border access
**Category** Privacy / elevation of privilege · **Asset** Class C · **Actor** Support agent; administrator; malicious insider
**Scenario** A support agent opens identity documents without a support case; an administrator bulk-downloads documents; access continues after role removal; documents stored in the EU are routinely accessed by staff in Canada.
**Impact** Privacy violation; potential regulatory exposure; no deterrent without auditing.
**Existing mitigation** Role separation exists and is tested (SUPPORT can view the review queue but cannot decide). `AdminAuditLog` records admin **decisions**.
**Gap identified:** it is **not established that document *views* are audited** — only decisions clearly are. A support agent reading an identity document may leave no record.
**Required Phase 1 mitigation** Confirm whether class C **reads** by staff are audited; if not, add an audit record for every staff access to a class C object (actor, subject, timestamp, route). This is a small change with high privacy value and belongs with this work.
**Required test** Staff access to a class C document produces an audit record; access after role removal is denied.
**Residual risk** Medium — technical auditing does not by itself prevent misuse; policy and review are also required. Cross-border access is tracked as **EV-07**, not resolved here.
**Severity** High · **Likelihood** Medium · **Priority** P1 · **Owner** Engineering + Owner · **Classification** CLOSED-BETA BLOCKER

### STG-25 — Real personal data used in testing
**Category** Privacy · **Asset** Class C · **Actor** Developer; automated tests
**Scenario** A real passport or government ID is uploaded to a test or staging bucket, or production data is copied into a test environment.
**Impact** Personal data outside its intended environment, outside retention governance, and in the least-trusted credential tier.
**Existing mitigation** Test fixtures use a synthetic 1×1 PNG (`TINY_PNG_BASE64`); the isolated test database is enforced by `test-db-guard.mjs`.
**Required Phase 1 mitigation** **Invariant 20 — real identity documents must never be used in automated testing, at any tier.** Provisioning checklist item 17 restricts the connectivity check to synthetic files.
**Required test** Fixture review; no production data path into test environments.
**Residual risk** Low.
**Severity** High · **Likelihood** Low · **Priority** P2 · **Owner** Engineering · **Classification** CLOSED-BETA BLOCKER

### STG-26 — Replay and duplicate upload
**Category** Spoofing / integrity · **Asset** Class B, C · **Actor** Attacker with a captured request
**Scenario** A captured upload request is resubmitted, creating duplicate verification evidence; or an older approved document replaces a newer one.
**Existing mitigation** Every upload generates a fresh UUID key, so a replay creates a new object rather than overwriting. Re-submission resets `idDocumentStatus` to `PENDING_REVIEW`, which is the safe direction (it cannot re-approve).
**Required Phase 1 mitigation** Ensure replacement always moves forward: a re-submission must never restore a previously approved state, and must not be able to revert `isCurrent`/`version` on listing documents.
**Required test** Duplicate request handled safely; replay cannot restore an approved state; version ordering preserved.
**Residual risk** Low. Duplicate objects from replay become orphans (STG-14).
**Severity** Medium · **Likelihood** Low · **Priority** P3 · **Owner** Engineering · **Classification** HIGH-PRIORITY FOLLOW-UP

---

## 4. Security invariants

Non-negotiable. Any change that violates one is a defect regardless of test results.

1. **Possession of an object key never grants access by itself.**
2. Every private read is authorized against **current** database ownership and role state.
3. Every private write is authorized against the intended resource and actor.
4. Production and staging **never** silently fall back to local disk.
5. No storage secret reaches the browser bundle.
6. No bucket is publicly accessible.
7. Test, staging and production **cannot** share credentials.
8. Test data **cannot** be written to production buckets.
9. Upload success requires **both** durable bytes and durable required metadata.
10. A missing object **cannot** be reported as a successful upload.
11. Deletion must respect legal hold and retention rules.
12. Replacement must not expose stale private objects.
13. Original filenames **cannot** control object keys or storage paths.
14. Sensitive identifiers and credentials **cannot** appear in logs.
15. Employer/third-party access cannot reveal identity or verification evidence by default.
16. Support and admin access must be role-based and auditable.
17. Object-store lifecycle **cannot** override application legal holds.
18. Production endpoint and bucket selection are environment-controlled, never user-controlled.
19. Storage errors fail truthfully and never create false success states.
20. **Real identity documents cannot be used in automated testing.**

---

## 5. Required security tests

**Authorization** — unauthenticated private read rejected · guest cannot access a host identity document ·
host A cannot access host B's document · seller cannot access an unrelated listing document · wrong
administrator role rejected · deactivated user rejected · ownership transfer uses current state · public
media route exposes only `APPROVED` media.

**Environment isolation** — production refuses the filesystem driver · staging refuses the filesystem
driver · test cannot resolve a production bucket · a wrong-environment bucket name is rejected where
detectable · missing production configuration fails closed at boot.

**Upload safety** — oversized rejected · unsupported type rejected · **extension/MIME mismatch rejected
(magic-byte sniffing)** · malicious filename cannot influence the object key · SVG remains unaccepted in
every subsystem · duplicate request handled safely · interrupted upload creates no success record.

**Consistency** — upload succeeds and metadata persists · upload failure leaves no successful metadata ·
metadata failure triggers object cleanup · missing object returns a truthful failure · replacement does
not expose the stale object · deletion respects legal hold · deletion failure is observable · concurrent
replacement is safe · key collision cannot overwrite another object.

**Privacy** — private object keys not unnecessarily exposed · no secret in the client bundle · no
credential in logs · no full class C identifier in logs · third-party routes cannot reach private
evidence · **staff access to class C is auditable**.

**Cross-instance durability (mandatory)** — upload from instance A → metadata persists → read from
instance B with no shared local state → restart → read still succeeds. **This is the test that would have
detected the original defect.**

**Endpoint safety** — user input cannot alter the endpoint · an unexpected endpoint form fails
configuration validation · redirects cannot cause SSRF · credentials never sent to an unapproved host.

**Operational** — behaviour when R2 is unavailable is truthful · authorization-denial, missing-object and
credential-failure signals are *specified* (implementation deferred) · rollback to a prior application
version neither exposes nor loses stored objects.

---

## 6. Phase 1 mitigation boundary

**Required before closed beta** — private buckets · correct authorization · environment isolation ·
fail-closed production configuration · upload validation incl. magic-byte sniffing · object/metadata
consistency · legal-hold-safe deletion · sensitive-logging controls · cross-instance durability test ·
synthetic data only · least-privilege credentials · **`Content-Disposition: attachment` on class B/C
(STG-12)** · **audit records for staff class C reads (STG-24)**.

**Required before public launch** — provider and legal gates resolved (EV-01…EV-07) · operational
monitoring · alerting · backup/restore evidence · security review of admin and support access ·
documented incident response · **credential-rotation procedure exercised at least once** · production
access review · privacy and retention approval · media-route rate limiting · reconsideration of
`failMode: 'open'` on document access.

**Future hardening (not Phase 1, not without owner approval)** — malware scanning · content moderation ·
direct multipart uploads · signed URLs · CDN transformation · automated orphan cleanup via database
reconciliation · regional bucket strategy · advanced download-abuse controls · content checksums.

---

## 7. Known architecture risks

| Risk | Assessment |
|---|---|
| **Proxy bandwidth and latency** | Every byte crosses the function twice. Accepted at beta scale; a scaling constraint, not a security flaw. |
| **Vercel function region** | Unconfigured (`iad1` default). Paired with EU storage this doubles latency. Owner decision pending. |
| **Postgres region dependency** | Every request touches the database; only file requests touch R2. Optimising the runtime for R2 could worsen the more common path. **Must be checked before choosing a region.** |
| **R2 EU endpoint** | Jurisdiction-scoped host; a misconfigured endpoint fails closed at boot rather than silently degrading. |
| **Application availability dependency** | All media now depends on the API being up — previously also true, but the proxy makes it total. No static fallback. |
| **Storage availability dependency** | An R2 outage means no photos and no document review. Must fail truthfully, never as a false success. |
| **Absence of monitoring** | STG-22. The most significant systemic weakness; several mitigations assume someone notices. |
| **No tested backup/restore** | STG-23. Object versioning is off, so deletion is final. |
| **Local adapter differs from R2** | The local driver cannot reproduce network failure, eventual consistency, or credential errors. This is precisely why the cross-instance test against real R2 is mandatory. |
| **Legal and provider gates open** | EV-01…EV-07, all OPEN. EV-01 could in principle affect testing itself. |

---

## 8. Security review outcome

### Scores

| Dimension | Score | Basis |
|---|---|---|
| **Overall storage security posture (design)** | **78 / 100** | Strong design: private buckets, proxy authorization on every read, random non-capability keys, row binding, fail-closed configuration, least-privilege credentials, retention authority preserved. Deductions: no monitoring, no backup/restore, no malware scanning, no content checksums, and two pre-existing gaps found here (STG-12, STG-24). |
| **Closed-beta readiness** | **58 / 100** | The design is ready; **nothing is implemented**. All 14 closed-beta-blocking mitigations remain to be built and tested. Score reflects readiness to *proceed*, not readiness to *operate*. |
| **Public-launch readiness** | **32 / 100** | Monitoring, alerting, backup/restore, incident response, rotation rehearsal, access review and all seven external-verification gates are open. |

### Blockers by classification

| Classification | Count | IDs |
|---|---|---|
| **CLOSED-BETA BLOCKER** | **14** | STG-01, 02, 03, 04, 05, 06, 07, 09, 10, 11, 12, 13, 15, 16, 17, 18, 19, 24, 25 *(several also carry a public-launch component; counted once at their strictest beta-blocking requirement)* |
| **PUBLIC-LAUNCH BLOCKER** | **5** | STG-08, 20, 22, 23, plus the ongoing-detection component of STG-05 |
| **HIGH-PRIORITY FOLLOW-UP** | **2** | STG-14 (before public launch), STG-26 |
| ~~**ACCEPTED RESIDUAL RISK**~~ **PROVISIONALLY TOLERATED — TEST IMPLEMENTATION ONLY** | **4** | STG-11 (malware scanning), STG-14 (orphans), ~~STG-20~~ *(removed — upgraded to blocker by D-2)*, STG-21 (no checksums) → **and STG-20's public-media component remains a public-launch item** |
| **FUTURE HARDENING** | **9** | Listed in §6 |

*Counting note: classifications overlap where a threat blocks the beta on one control and public launch on
another. The strictest applicable classification governs.*

### Top five risks

1. **STG-05 — Bucket made public by misconfiguration.** Catastrophic impact (mass identity-document disclosure), no application-side guard, and no monitoring to detect a later change. Mitigated only by manual verification and by denying the application any token that could enable it.
2. **STG-22 — No monitoring or alerting.** Systemic. Several other mitigations silently assume a human notices; today nobody would.
3. **STG-10 — Silent fallback to local disk in production.** Would reintroduce the exact defect this workstream exists to fix, while appearing healthy. Fail-closed boot validation is the whole mitigation.
4. **STG-01 / STG-02 — Broken object-level authorization, including stale ownership.** The highest-value target in the system; currently well controlled, and the migration must not weaken it.
5. **STG-17 — Legal-hold violation via lifecycle or deletion path.** Potentially irreversible destruction of evidence. Mitigated architecturally by prohibiting age-based deletion, but with no application-side guard against a lifecycle rule being added later.

### Exact implementation requirements

1. Storage abstraction with explicit driver selection; production rejects the local driver.
2. Boot-time configuration validation: driver, endpoint form, credentials, both bucket names; reject test-named buckets in production.
3. Test-environment guard rejecting the `s3` driver.
4. Magic-byte sniffing across all six subsystems.
5. Preserve authorization, key-shape validation and row binding unchanged.
6. Enforce object → database → cleanup ordering in all six modules.
7. Legal-hold check before any object deletion.
8. **`Content-Disposition: attachment` on all class B/C file responses (STG-12).** — **partially met as of 2026-07-23: 6 of 9 routes; the three frozen Ride/Québec routes remain outstanding.**
9. **Audit record for every staff read of a class C object (STG-24).**
10. Sensitive-logging controls on every storage error path.
11. Full test suite per §5, including the mandatory cross-instance durability test against real R2.
12. No user input may reach endpoint, bucket, or credential selection.

### Owner decisions — status after the 2026-07-22 decision record (§0)

| # | Decision | Status |
|---|---|---|
| **D-1** | Application runtime region | **OPEN.** Database path investigated (Neon, region never chosen and **immutable once set**). Neon region should be decided **before** the Vercel region. No region selected; no Vercel configuration changed. Implementation plan §14 |
| **D-2** | Rate limiting and fail mode | **RESOLVED — direction approved.** Private routes fail-closed with a truthful `503`; public media gets a separate bounded, availability-aware policy. Implementation plan §15 |
| **D-3** | Replacement of submitted evidence | **RESOLVED — governance approved**, with the storage-layer scope boundary defined. One open tension recorded: current ID-document replacement *deletes* the prior object. Implementation plan §16 |
| **D-4** | STG-12 and STG-24 in Phase 1 | **RESOLVED — both APPROVED as required Phase 1 mitigations.** Implementation plan §17 |
| **D-5** | Residual risk acceptance | **RESOLVED — not accepted.** Status is **PROVISIONALLY TOLERATED FOR TEST IMPLEMENTATION ONLY**; reassess after implementation, security tests, cross-instance verification, failure-mode testing, staff-audit testing and private-PDF download testing. **No residual risk is approved for public launch** |

### New owner decisions arising from this round

| # | Decision | Note |
|---|---|---|
| **D-6** | **Neon Postgres region** — irreversible once a project is created; never chosen; not recorded anywhere | Must be decided **before** D-1. Neon EU options: `aws-eu-central-1` (Frankfurt), `aws-eu-west-2` (London — outside the EU) |
| **D-7** | **Retention of superseded identity documents** | Current behaviour deletes the prior object on replacement (privacy-motivated); D-3 governance says prior evidence is retained "where retention permits". These conflict and the owner must resolve which governs |

### Final decision

# A. READY FOR TEST INFRASTRUCTURE PROVISIONING

**No design correction is required before provisioning.** The approved architecture has no blocking
design defect: authorization is application-enforced and unchanged by the migration, keys are not
capabilities, buckets are private, configuration fails closed, and retention authority stays with the
application.

Two pre-existing gaps were found during this review — **STG-12** (private PDFs served inline with no
`Content-Disposition`) and **STG-24** (staff reads of identity documents may not be audited). Neither
blocks provisioning; both should be folded into Phase 1 implementation, since the code paths are already
being modified. That is owner decision **D-4**.

**This document does not approve production launch, and must not be read as doing so.** Public launch
remains blocked by STG-08, 20, 22, 23, the ongoing-detection component of STG-05, and all seven external
verification gates (EV-01…EV-07).
