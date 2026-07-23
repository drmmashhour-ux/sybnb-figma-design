# SYBNB — Architecture Freeze Review 2026

**Date:** 2026-07-22
**Type:** Review only. **No implementation, no code change, no configuration change, no infrastructure created.**
**Branch:** `claude/intelligent-kilby-5ff258` — 30 commits since base, no upstream, **not pushed**.

**Frozen at:**

| Checkpoint | Commit | Scope |
|---|---|---|
| Storage implementation | `79a3bbb` | `feat(storage): add private persistent media and document storage` |
| Storage documentation | `6b92b07` | `docs(storage): preserve R2 architecture and provisioning records` |
| STR trust truthfulness (C5) | `3f7d08e` | `feat(str): replace unsupported trust claims with truthful verification states` |

> **This document does not claim production readiness, and must not be read as doing so.** It records
> what is built, what is frozen, what remains, and in what order the remaining work should be taken.

---

## 1. Completed architecture

### 1.1 Storage — **frozen at `79a3bbb`**

One governed service (`server/lib/object-storage.mjs`) with two drivers behind a single interface:
`local` for development and automated tests, `s3` for staging, production and verification. Driver
selection is **explicit** via `STORAGE_DRIVER`; a missing or unrecognised value throws rather than
defaulting, because a storage backend chosen implicitly is precisely how the original defect reached
production unnoticed.

Backing store: Cloudflare R2, **EU jurisdiction**, six buckets (media/documents × test/staging/
production), **all private** — no public development URL, no custom domain, no bucket policy granting
anonymous read, no bucket CORS.

**Four of six upload subsystems migrated:** `listing-media-storage`, `id-document-storage`,
`listing-document-storage`, `thread-document-storage`. Two remain on local disk by explicit scope
restriction — see §2 and §4.

### 1.2 Authentication and authorization boundaries — **unchanged by the storage work**

This is the single most important property of the migration: **the byte destination moved; the
authorization model did not**. Media reads still bind the object key to its owning `ListingMedia` row
and gate on listing status (public once `APPROVED`, owner/admin while draft). Identity-document reads
still resolve the key from `context.user.idDocumentRef` — no caller-supplied identifier participates,
so retrieval by raw object key is structurally impossible rather than merely blocked.

**Possession of an object key grants nothing.** That invariant survived the migration intact.

### 1.3 Media handling — **frozen at `79a3bbb`**

Allowlist exactly `image/jpeg` · `image/png` · `image/webp`, enforced against the declared MIME type
**and** the actual file signature. RIFF containers must also carry the `WEBP` marker, so a WAV cannot
pass as an image. 8 MB ceiling on the decoded buffer. Object written before the database row; if the
row fails, the object is deleted. `Content-Type` derived from the stored key, `Content-Length` set,
cache policy split public/private by approval state.

### 1.4 Private document handling — **frozen at `79a3bbb`**

Allowlist exactly `application/pdf` · `image/jpeg` · `image/png`, dual-layer enforced. WebP, GIF, SVG,
HEIC, TIFF, ZIP, executables and office documents are rejected on the document path and **locked by
regression test** so an allowlist edit cannot quietly re-admit one.

Downloads are forced: `Content-Disposition: attachment` with a server-derived filename built from a
category allowlist plus the stored MIME — there is no code path admitting caller input, the storage
key, or a user id. Plus `private, no-store`, `nosniff`, and `Content-Length`.

Staff reads emit `STAFF_DOCUMENT_ACCESSED` through the existing `AdminAuditLog`, carrying metadata
only. Worker self-access is deliberately unaudited — reading your own document is self-service, not
oversight.

### 1.5 Configuration — **frozen at `79a3bbb`**

`validateProductionConfig()` refuses to boot on the local driver in production, on any missing
endpoint/credential/bucket, or on a bucket name that looks non-production. `NODE_ENV=test` refuses the
`s3` driver **at boot and at driver use** — the boot check alone was insufficient because it only runs
in production. The test suite additionally pins itself to a temp directory and actively deletes any
`STORAGE_S3_*` values it finds, so a credential in a developer's shell cannot reach a live bucket.

Credentials are environment-only, server-side only, never `VITE_`-prefixed. Endpoint and bucket
selection are environment-controlled; **no route accepts an endpoint, bucket, or credential from a
request**.

### 1.6 Security — **frozen at `79a3bbb`**

Errors never carry a bucket name, endpoint, account ID, key ID, secret, provider error, raw query, or
filesystem path — asserted by test on both paths. Two threat-model findings closed: **STG-12** (inline
rendering of private PDFs) and **STG-24** (unaudited staff document views). Both were pre-existing
defects found during review, not introduced by this work.

### 1.7 Testing

| Suite | Files | Tests |
|---|---|---|
| Unit | 22 | **301** |
| API | 61 | **462** |
| Security | 4 | **21** |
| **Total** | **87** | **784** |

Of these, **5 files are storage-specific** (86 tests). TypeScript clean; production build clean;
`npm audit --omit=dev` reports **0 vulnerabilities**.

Everything was written test-first: each phase's suite was confirmed failing before implementation.

### 1.8 Documentation — **frozen at `6b92b07`**

ADR-0010 (decision record), R2 configuration guide, manual provisioning checklist, data-residency
decision brief, external-verification launch gates, persistent-storage implementation plan, STR
storage threat model. Seven documents, all tracked, forming a closed reference cluster.

---

## 2. Frozen systems

| System | Status | Checkpoint |
|---|---|---|
| Persistent object storage (abstraction, media, private documents) | **FROZEN** | `79a3bbb` |
| Storage architecture documentation | **FROZEN** | `6b92b07` |
| C5 — truthful host verification states | **FROZEN** | `3f7d08e` |
| SYBNB Ride / SR | **FROZEN** — untouched throughout | *(pre-existing)* |
| Quebec Edition / CITQ / CTQ | **FROZEN** — untouched except one synthetic test fixture | *(pre-existing)* |
| STR launch roadmap v1.1 | **FROZEN** by owner policy | *(pre-existing)* |

The Quebec exception is `test/api/quebec-document-compliance.test.mjs`, whose synthetic PDF fixture was
plain text declared as `application/pdf` and was correctly rejected by the new signature check. It now
carries a real `%PDF` header. **No Quebec logic was touched.**

---

## 3. Outstanding architectural work

### 3.1 Security hardening
- **STG-11** — deep parsing, malware scanning, content disarm
- **STG-14** — orphaned-object reconciliation
- Media-route rate limiting; reconsider `failMode: 'open'` on `DOCUMENT_ACCESS`
- Content checksums for byte-level integrity detection

### 3.2 Infrastructure
- **Neon Postgres region (D-6)** — never chosen, **irreversible once a project is created**
- **Vercel runtime region (D-1)** — unconfigured, defaults to `iad1` against EU storage
- Staging environment provisioning
- **Observability** — no monitoring, alerting, or structured logging anywhere
- **Backup and restore** — no documented procedure, never rehearsed; R2 object versioning is off, so a
  deletion is final

### 3.3 Governance
- **EV-01…EV-07** — Cloudflare and Vercel eligibility for the intended service and user geography,
  sanctions and export control, applicable privacy regime, Canadian corporate obligations, EU-storage
  obligations, cross-border administrator access. All **OPEN**; none is a legal conclusion.
- **D-7** — superseded identity-document retention
- Credential rotation procedure — written, never exercised
- Roadmap reconciliation (C3 unrecorded, H10 over-scoped, C4 and H3 clarifications)

### 3.4 Product
- **C4** — availability fetched and expanded into a blocked-date set that is **never read**; a blocked
  date is currently quotable and bookable
- **H3** — hosts cannot configure a payout method
- **C7** — no confirmation on irreversible money or moderation actions
- Division isolation — eight divisions publicly exposed when one is operable
- Fabricated fallback inventory removal

### 3.5 Technical debt
- `byteSize` computed but not persisted
- `AdminAuditLog` has no purpose/case-reference column
- Audit-write failure is non-blocking with no alert routing
- `driver-document-storage.mjs` and `quebec-document-storage.mjs` still on local disk
- DX-001, TEST-001, TEST-002 in the existing technical-debt register

---

## 4. Open decisions

| Ref | Impact | Urgency | Depends on | Blocks production? |
|---|---|---|---|---|
| **STG-11** — deep parsing / malware scanning | Medium. A well-formed but malicious image or PDF passing signature validation is stored and later opened by a reviewer. Bounded by the 8 MB limit and strict CSP; not eliminated | Medium | Scanning service or library selection; none approved | **No** for closed beta; **reassess before public launch** |
| **STG-14** — orphan reconciliation | Low-medium. A process crash between object write and metadata commit orphans an object. Costs storage; an orphaned *identity document* also sits outside every retention path and outside a data-subject deletion request | Low at beta volume | Database reconciliation job. **Must not** be done with a bucket lifecycle rule — that would risk deleting live or legally-held objects | **No** |
| **D-7** — superseded identity-document retention | **High.** Governs how long government identity documents persist. Current behaviour deletes the prior document on replacement | **High** — settle before real identity documents are replaced in the beta | Needs versioning and hold state on identity documents, which do not exist (`User.idDocumentRef` has no `legalHold`/`replacesId` equivalent, unlike `ListingDocument`) | **No** technically; **yes** for defensible operation. **Reversibility is asymmetric** — retention→deletion is easy, deletion→retention cannot recover what is gone |
| **byteSize persistence** | Low. Prevents size-based integrity checks and `Content-Length` from metadata | Low | One column; a schema change | **No** |
| **Audit purpose / case reference** | Medium. "Why did this staff member open this document" is uncaptured, weakening the STG-24 boundary from oversight to mere logging | Medium | Schema change on `AdminAuditLog`, or a separate access-log table | **No** technically; relevant to privacy review (EV-07) |
| **Audit alert routing** | Medium. Audit-write failure is swallowed; nobody learns of it | Medium | **Blocked on observability existing at all** (STG-22) | **No** technically; **yes** in practice for public launch |
| **Ride document storage** | **High.** `driver-document-storage.mjs` still writes driver licences and vehicle registrations to ephemeral local disk — **the original defect, unfixed** | High **if SR is ever deployed**; none while SR stays frozen | Owner decision to unfreeze Ride. The fix is mechanical — the module is structurally identical to the four already migrated | **No** while SR is frozen; **yes** the moment it is not |
| **Quebec document storage** | Medium. Same defect in `quebec-document-storage.mjs` | Low while Quebec is frozen | Owner decision to unfreeze Quebec | **No** while frozen |

---

## 5. Production readiness

### Ready for implementation
The storage abstraction is a stable foundation. Migrating the two remaining modules, adding `byteSize`,
adding an audit purpose column, or adding orphan reconciliation are all well-defined against an
existing interface — no design work is required first.

### Ready for internal testing
**Yes.** The storage subsystem can be exercised end-to-end against the R2 test bucket with synthetic
data. The mandatory cross-instance durability verification against real R2 **has not yet been run** —
configuration passed 12/12, but no object has been written to R2. **That verification is the gate
between internal testing and any deployed environment.**

### Ready for closed beta
**Not yet.** Storage is ready; the beta is not. Outstanding: C4 (availability enforcement), H3 (host
payout configuration), division isolation, fabricated-fallback removal, D-7, a staging environment,
and the regional decisions D-1/D-6.

### Ready for production
**No — and this document makes no such claim.** Production is unapproved and unprovisioned: only the
two test buckets exist, only test credentials are injected, staging and production have never been
provisioned, EV-01…EV-07 are all open, there is no monitoring, and no backup or restore has ever been
rehearsed.

---

## 6. Risks, ranked

### Critical
1. **Public-launch gates unresolved (EV-01…EV-07).** Whether Cloudflare and Vercel permit the intended
   service and user geography is unanswered. A negative answer invalidates the hosting and storage
   architecture, not merely a feature. This is the only risk that could void completed work.
2. **No backup or restore.** R2 object versioning is off, so a deletion is final; the database and
   object store have no coordinated point-in-time story and no restore has been rehearsed. A mistake is
   currently unrecoverable.

### High
3. **No observability.** Storage failures, authorization-denial spikes, unexpected deletions and
   credential failures are all invisible until a user reports them. Several mitigations across the
   threat model quietly assume someone notices; today nobody would.
4. **Bucket misconfiguration (STG-05).** Enabling public access on the production documents bucket would
   expose every identity document. There is no application-side guard — only the checklist, and the
   deliberate choice to give the application a token that cannot change bucket settings.
5. **Ride document storage still defective.** Contained only by SR remaining frozen. Unfreezing SR
   without migrating that module reintroduces silent data loss on the most sensitive driver documents.
6. **D-7 undecided while the beta approaches.** Deletion is irreversible; every replacement that happens
   before the decision forecloses a retention option permanently.

### Medium
7. **Regional decisions unmade, one irreversible.** The Neon region is fixed at project creation and has
   never been chosen. Choosing the reversible Vercel region first risks anchoring against it.
8. **STG-11 residual content risk.** Signature validation is not malware scanning.
9. **Audit boundary is logging, not oversight** — no purpose captured, failures unrouted.
10. **Rate-limit fail-open on document access.** If Redis is unavailable, private-document access
    becomes unlimited; the public media route is not rate-limited at all.

### Low
11. **Orphaned objects (STG-14)** — cost and privacy residue at beta volume.
12. **`byteSize` not persisted** — forecloses a cheap integrity check.
13. **Quebec document storage** — same defect, smaller blast radius, frozen context.

---

## 7. Recommended implementation order

Not authorized; recommended sequencing only.

**Wave 1 — prove the storage fix is real (days)**
1. Cross-instance durability verification against the R2 test bucket. Until this runs, the central
   claim of `79a3bbb` is untested against the real backend.
2. Decide **D-6 (Neon region)** before **D-1 (Vercel region)** — one is irreversible, the other is not.
3. Provision staging.

**Wave 2 — make failure visible (weeks)**
4. Observability: error aggregation and the storage signals named in the threat model.
5. Backup and restore procedure, then **rehearse a restore**.
6. Exercise credential rotation once.

**Wave 3 — unblock the closed beta (weeks)**
7. **C4** — enforce availability. The blocked-date set is already computed; this is enforcement, not
   data-fetching.
8. **H3** — host payout configuration.
9. Division isolation and fabricated-fallback removal.
10. **D-7** — decide retention **before** real identity documents are replaced.

**Wave 4 — governance, in parallel from now**
11. EV-01…EV-07 with counsel and the providers. Long lead time; start immediately, not after Wave 3.
12. Registered legal entity on the legal pages (roadmap B1).

**Wave 5 — hardening, post-beta**
13. STG-11, STG-14, media rate limiting, audit purpose column, `byteSize`, Ride and Quebec storage
    migration when those contexts unfreeze.

---

## 8. Repository review — verified

| Check | Result |
|---|---|
| Credential leaks | **None.** Access key, secret key and account ID each appear in **0 files** at HEAD and **0 occurrences** across full git history |
| Public buckets | **None.** `r2.dev`, `PutBucketPolicy`, `PutBucketAcl`, `public-read` — 0 occurrences in tracked source |
| Signed URLs | **None.** `getSignedUrl` — 0 occurrences |
| Bucket CORS | **None.** `PutBucketCors` — 0 occurrences |
| Browser credentials | **None.** `VITE_STORAGE`, `VITE_S3`, `VITE_R2` — 0 occurrences |
| Checkpoints preserved | `79a3bbb` and `6b92b07` both resolve; `79a3bbb` unmodified |
| Unfinished storage migrations | **Two, both deliberate and documented:** `driver-document-storage.mjs`, `quebec-document-storage.mjs`. The four in-scope modules are fully migrated with no partial state |
| Isolation from Ride and Quebec | **Clean.** The four new storage modules contain **zero** Ride or Quebec domain references, and neither out-of-scope module imports the new abstraction. *(A naive grep reports 38 "driver" hits in `object-storage.mjs`; all are the storage-**driver** concept — `STORAGE_DRIVER`, `localDriver`, `s3Driver` — not SR's driver domain.)* |

---

## 9. What this review does not say

It does not say the platform is ready to launch. It does not say storage is verified in production —
no object has ever been written to R2. It does not resolve any open finding. It does not approve
provisioning, deployment, or the unfreezing of any frozen system.

What it does say: the storage subsystem is coherent, tested, documented, isolated, free of credential
leaks, and frozen at a known-good checkpoint — and the work that remains is now visible and ordered.
