# AGENT 3 — Security, Privacy and Governance Independent Review

**Reviewer role:** Security, Privacy and Governance Architect (independent, first-pass)
**Baseline reviewed:** commit `8a4eba79e342c1d4386905514626ff2fd866ea89` (`8a4eba7`), branch `claude/intelligent-kilby-5ff258`, dated 2026-07-22 23:25:11 -0400, message `docs(storage): add architecture freeze review and validation baseline`
**Working tree state at review time:** tracked tree clean. Untracked-only additions present and **excluded from the baseline assessment**: `vite.uicheck.config.ts`, `.claude/`, and five untracked `docs/product/*.md` files (`SYBNB_DIVISION_ISOLATION_PLAN.md`, `SYBNB_FABRICATED_DATA_REMEDIATION_INVENTORY.md`, `SYBNB_FULL_PLATFORM_LAUNCH_READINESS_REVIEW.md`, `SYBNB_ROADMAP_RECONCILIATION_PROPOSAL.md`, `SYBNB_STR_CLOSED_BETA_BOUNDARY.md`). Nothing in this review depends on them.
**Review date:** 2026-07-22
**Mode:** read-only. No source, test, config, dependency, or environment file was modified. No install, no network call to any provider, no deployment.
**Parallel-review isolation:** `docs/reviews/final-independent-review/AGENT_1_*` and `AGENT_2_*` were not read. At the time this report was written the directory contained no other files.

---

## 1. Scope

Authentication · authorization · role boundaries · division isolation · fail-closed behaviour · media access · private-document access · staff access auditing · secrets handling · environment isolation · data minimization · identity-document governance · retention · replacement · legal and fraud holds · incident handling · privacy exposure · logging · auditability · AI boundaries · consent · compliance claims · external-verification gates · launch governance · production approval boundaries.

Out of scope, deliberately: visual design, financial-model correctness, business-logic correctness outside the controls above, and any legal conclusion.

---

## 2. Method

Every finding below carries the eight required fields. The method applied was:

1. Baseline fixed at `8a4eba7` and verified with `git log -1` and `git status --porcelain`.
2. Documents and modules read in full or in the relevant range (inventory in §3).
3. Every claim classified as **CONFIRMED FACT** (directly observed in the baseline tree) or **INFERENCE** (reasoned consequence, labelled as such).
4. Exact file paths, symbols and line references cited.
5. Severity assigned Critical / High / Medium / Low on security and privacy impact, not on effort.
6. Launch impact stated against four bands: blocks internal testing / blocks closed beta / blocks public production / does not block launch.
7. A narrow correction recommended — the smallest change that closes the specific gap, never a redesign.
8. The required work type stated: code / documentation / governance / infrastructure / owner input.

**Verification posture.** Documentation was treated as a claim to be tested, not as evidence. Where a document asserts a control, the control was located in code. Where it could not be located, the divergence is itself recorded as a finding. Where a claim was checked and held, that is recorded too (§6).

**Credential handling.** No credential value was printed, echoed, copied, or reproduced in any form. Existence and absence were verified structurally only.

---

## 3. Inspected inventory

### 3.1 Server modules

`server/index.mjs` · `api/index.mjs` · `vercel.json` · `server/contracts.mjs` (partial) ·
`server/lib/env.mjs` · `server/lib/allowed-origins.mjs` · `server/lib/security-headers.mjs` · `server/lib/security.mjs` · `server/lib/auth-context.mjs` · `server/lib/responses.mjs` ·
`server/lib/rate-limit.mjs` · `server/lib/rate-limit-store.mjs` ·
`server/lib/object-storage.mjs` · `server/lib/content-signature.mjs` · `server/lib/private-document-download.mjs` · `server/lib/document-access-audit.mjs` ·
`server/lib/id-document-storage.mjs` · `server/lib/listing-media-storage.mjs` · `server/lib/listing-document-storage.mjs` · `server/lib/thread-document-storage.mjs` · `server/lib/driver-document-storage.mjs` · `server/lib/quebec-document-storage.mjs` ·
`server/lib/listing-document-retention.mjs` · `server/lib/compliance-feature-flags.mjs` · `server/lib/ai-insights.mjs`

### 3.2 Routes

`server/routes/auth.mjs` · `server/routes/me.mjs` · `server/routes/admin.mjs` · `server/routes/listings.mjs` · `server/routes/messages.mjs` · `server/routes/driver.mjs` · `server/routes/quebec-driver-onboarding.mjs` · `server/routes/compliance.mjs` (retention call sites)

### 3.3 Schema, frontend, scripts

`prisma/schema.prisma` (`RoleName`, `AdminAuditLog`, `isDemo`, `ComplianceFeatureFlag`) · `src/backend/contracts.ts` · `src/shared/api/platformApi.ts` · `src/app/App.tsx` · `src/modules/legal/LegalPlaceholderPage.tsx` · `scripts/seed-demo-accounts.mjs`

### 3.4 Documents

`docs/security/STR_STORAGE_THREAT_MODEL.md` · `docs/product/SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md` · `docs/product/SYBNB_R2_CONFIGURATION_GUIDE.md` · `docs/architecture/ARCHITECTURE_FREEZE_REVIEW_2026.md` · `docs/store/DEMO_ACCOUNTS.md` · `docs/product/STORAGE_VALIDATION_WAVE_1_PLAN.md` and `SYBNB_R2_MANUAL_PROVISIONING_CHECKLIST.md` (targeted reads)

### 3.5 Repository-wide scans performed

Prohibited-pattern greps (`getSignedUrl`, `s3-request-presigner`, `presign`, `PutBucketCors`, `PutBucketPolicy`, `PutBucketAcl`, `public-read`, `ACL:`, `r2.dev`, `VITE_*`), tracked-file credential scan, and a full `git log --all -p` credential-pattern scan across history.

---

## 4. Findings

Ordered by severity, then by launch impact.

---

### A3-01 — The `SUPPORT` role is exempt from the staff sign-in step-up while holding the broadest identity-document authority in the platform

**Severity: Critical**
**Launch impact: blocks closed beta**

**Status of claim: CONFIRMED FACT.**

`server/routes/auth.mjs:37` defines the second-factor set:

```js
const STAFF_ROLES_REQUIRING_OTP = new Set(['ADMIN', 'HOST', 'DRIVER', 'SELLER'])
```

`SUPPORT` is absent. The login handler (`server/routes/auth.mjs:431`) computes `needsStaffOtp` from that set, so an account whose only role is `SUPPORT` authenticates on **password alone** — no email or phone one-time code — while `HOST`, `DRIVER` and `SELLER`, all of which hold strictly less data authority, are gated.

What a `SUPPORT`-only account can reach with a password alone, all confirmed in `server/routes/admin.mjs`:

| Capability | Location | Authorization |
|---|---|---|
| Read **any** user's identity document bytes | `admin.mjs:370–409` | `requireAuth(context, ['ADMIN','SUPPORT'])` |
| **Upload** an identity document on behalf of any user, replacing and destroying the prior one | `admin.mjs:442–498` | `['ADMIN','SUPPORT']` |
| Look up any account by email address | `admin.mjs:414–440` | `['ADMIN','SUPPORT']` |
| Read the **entire** admin audit log, including its own access records | `admin.mjs:500–518` | `['ADMIN','SUPPORT']` |
| Export the full driver registry with PII (email, plate, payout method) | `admin.mjs:~318–360` (`/api/admin/drivers/export`) | `['ADMIN','SUPPORT']` |
| Read any driver document | `admin.mjs:1023–1039` | `['ADMIN','SUPPORT']` |
| Read any listing compliance document | `listings.mjs:675–711` | staff check inline |
| Read any message-thread attachment | `messages.mjs:212–245` | staff check inline |
| Read any Québec driver/vehicle document | `quebec-driver-onboarding.mjs:182–199, 427–444` | staff check inline |

The threat model classifies identity documents as **class C — "Never public under any condition ... Highest" retention sensitivity** (`docs/security/STR_STORAGE_THREAT_MODEL.md`, §2). The role with unrestricted read access to class C data is the one role with no step-up.

`SUPPORT` is correctly excluded from public self-registration (`auth.mjs:27`, `PUBLIC_REGISTER_ROLES = {GUEST, HOST, SELLER, DRIVER}`), so the role cannot be self-granted. That control is intact and is not the issue. The issue is the authentication strength of a legitimately provisioned `SUPPORT` account.

**INFERENCE (labelled):** a single credential-stuffing or phishing success against one support account yields bulk identity-document access. The one compensating control — the `STAFF_DOCUMENT_ACCESSED` audit record — is written to a table the same account can read, is best-effort (A3-13), and has no alerting behind it (STG-22, open).

**Narrow correction:** add `'SUPPORT'` to `STAFF_ROLES_REQUIRING_OTP` in `server/routes/auth.mjs:37`. One-token change; the OTP machinery, the `staff-login` purpose, and the rate limits already exist and need no modification.

**Required:** code (one line) + governance (record the decision that every staff role carrying class B/C read authority is step-up gated, so a future role addition inherits the rule).

---

### A3-02 — STG-12 is recorded CLOSED, but forced download is implemented on only 2 of 6 private-document serve paths

**Severity: High**
**Launch impact: blocks closed beta**

**Status of claim: CONFIRMED FACT.**

`docs/security/STR_STORAGE_THREAT_MODEL.md:39` states:

> **STG-12** — inline rendering of private PDFs — **CLOSED.** Private documents are served with `Content-Disposition: attachment` ...

and §8 "Exact implementation requirements" item 8 requires:

> **`Content-Disposition: attachment` on all class B/C file responses (STG-12).**

`privateDocumentDownloadHeaders()` (`server/lib/private-document-download.mjs:38`) is the function that sets that header. A repository-wide grep for its call sites returns exactly two:

- `server/routes/admin.mjs:402` — admin reads a user's identity document
- `server/routes/me.mjs:212` — a user reads their own identity document

Four further private-document serve paths write their own headers and set **no** `content-disposition`, so a PDF renders **inline** in the reader's authenticated, same-origin browser session:

| Path | Line | Headers actually set | Class |
|---|---|---|---|
| `server/routes/messages.mjs` — thread attachment | `242` | `content-type`, `cache-control: private, no-store` | B/C |
| `server/routes/listings.mjs` — listing compliance certificate | `707` | `content-type`, `cache-control: private, no-store` | B |
| `server/routes/admin.mjs` — driver document | `1035` | `content-type`, `cache-control: private, no-store` | C |
| `server/routes/driver.mjs` — driver document (self/staff) | `313` | `content-type`, `cache-control: private, no-store` | C |
| `server/routes/quebec-driver-onboarding.mjs` — driver document | `194` | `content-type`, `cache-control: private, no-store` | C |
| `server/routes/quebec-driver-onboarding.mjs` — vehicle document | `440` | `content-type`, `cache-control: private, no-store` | C |

The thread-attachment path is the most exposed of the six. Its content is uploaded by an **arbitrary counterparty** to a booking inquiry (`messages.mjs:197–210`), and it is then opened inline by the listing owner or by staff. That is precisely the adversary model `private-document-download.mjs:1–11` describes, and it is the one path that never received the mitigation.

Two mitigating facts, stated so the severity is not overstated. First, `applySecurityHeaders()` (`server/index.mjs:89`) runs before every handler and sets `content-security-policy: default-src 'none'` and `x-content-type-options: nosniff` via `setHeader`, which survive the later `res.writeHead`. Second, `private-document-download.mjs:5–7` itself records that CSP enforcement inside a browser's built-in PDF viewer is implementation-dependent and "must not be the only defence" — which is the entire reason forced download was adopted. The defence-in-depth layer that the threat model calls a required Phase 1 mitigation is absent on four of six paths.

**The documentation defect is itself a finding.** STG-12 is recorded as CLOSED against a requirement that says "all class B/C file responses". It is closed for identity documents only. Anyone reading the threat model would conclude the control is complete.

**Narrow correction:** replace the four inline `res.writeHead(200, {...})` header literals with `privateDocumentDownloadHeaders({ mimeType, category, byteLength })`, adding the corresponding server-chosen category constants. `KNOWN_CATEGORIES` in `private-document-download.mjs:21` already contains `listing`, `thread`, `verification` and `document`, so no allowlist change is needed. Then correct the STG-12 status line to state the exact scope closed.

**Required:** code (six call sites) + documentation (correct the CLOSED claim to its true scope).

---

### A3-03 — STG-24 is recorded CLOSED, but staff document-access auditing covers 1 of 6 private-document read paths

**Severity: High**
**Launch impact: blocks closed beta**

**Status of claim: CONFIRMED FACT.**

`docs/security/STR_STORAGE_THREAT_MODEL.md:40`:

> **STG-24** — staff document-view auditing — **CLOSED at the approved boundary.** Staff reads emit `STAFF_DOCUMENT_ACCESSED` ...

and §8 requirement 9: *"Audit record for every staff read of a class C object (STG-24)."*

`recordStaffDocumentAccess()` (`server/lib/document-access-audit.mjs:31`) has exactly **one** call site in the entire tree: `server/routes/admin.mjs:393`, the admin identity-document read.

Staff reads that leave **no trace whatsoever**:

- `server/routes/admin.mjs:1035` — driver document (class C: licence, vehicle registration, insurance)
- `server/routes/driver.mjs:313` — driver document via the staff branch (`isStaff` at line 305)
- `server/routes/quebec-driver-onboarding.mjs:194` and `:440` — Québec driver and vehicle documents (class C)
- `server/routes/listings.mjs:707` — listing compliance certificate (class B), staff branch at line 692
- `server/routes/messages.mjs:242` — thread attachment, staff branch at line 232
- `server/routes/listings.mjs:476` — a staff read of an **unapproved draft listing's** private photos

The module's own header comment (`document-access-audit.mjs:3–7`) states the motivation exactly: *"a support agent could open an identity document and leave no trace."* That is still true for driver documents, Québec documents, listing certificates, thread attachments and draft media.

This directly weakens `EV-07` in `docs/product/SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md:94–103`, which frames cross-border staff access around a single route (`/api/admin/id-document/:userId/file`). The register understates the actual access surface: there are at least seven staff-reachable private-document routes, six unaudited.

**Two further gaps, both correctly self-recorded in the module and reconfirmed here:**

- **No purpose or case reference.** `AdminAuditLog` (`prisma/schema.prisma:1049–1065`) has no column for it. "Why did this staff member open this document" is unanswerable. `document-access-audit.mjs:13–15` names this and correctly declines to invent a schema change.
- **`AdminAuditLog.ipHash` is declared (`schema.prisma:1057`) and never written.** A repository-wide grep for `ipHash` across `server/` returns zero occurrences. The column exists as an unfulfilled intent.

**Narrow correction:** call `recordStaffDocumentAccess()` on the staff branch of each of the six remaining paths, with the server-chosen category already defined per storage module. Then correct the STG-24 status line to state the exact routes covered. The purpose/case-reference column remains an owner decision and should not be invented here.

**Required:** code (six call sites) + documentation (correct the CLOSED claim) + owner input (purpose-column schema decision, D-7 follow-up).

---

### A3-04 — Approved decision D-2 requires private document routes to be fail-closed; the code is fail-open, and several document routes have no rate-limit rule at all

**Severity: High**
**Launch impact: blocks closed beta**

**Status of claim: CONFIRMED FACT.**

`docs/security/STR_STORAGE_THREAT_MODEL.md:30` records owner decision **D-2** as *approved direction*:

> Private document routes become **fail-closed** with a truthful `503` when the limiter cannot be evaluated.

§8's decision table records D-2 as **RESOLVED — direction approved**.

The code does the opposite. `server/index.mjs:68`:

```js
{ name: 'DOCUMENT_ACCESS', method: 'GET', pattern: /^\/api\/(admin\/id-document|me\/id-document)\/[^/]+(\/file)?$/, max: 30, windowMs: 60 * 1000, byUser: true, failMode: 'open' },
```

`failMode: 'open'`. `server/lib/rate-limit.mjs:113–126` confirms the consequence: when the distributed store is unreachable, the request is **allowed** and only a `console.error` is emitted. Under an Upstash outage, identity-document reads become unrated-limited. The comment at `server/index.mjs:62–66` classifies `DOCUMENT_ACCESS` as an "authenticated business operation" in the fail-open bucket — a classification that contradicts D-2's explicit carve-out for private document routes.

**Coverage gaps in the same table.** `matchRateLimitRule` (`server/index.mjs:77`) matches on exact `method` plus `pattern`. The following privileged or expensive routes match **no rule** and are therefore entirely unlimited:

| Route | Method | Why it matters |
|---|---|---|
| `/api/me/id-document` | `PATCH` | Identity-document **upload**. Up to 8 MB decoded per call, unbounded call rate. The `DOCUMENT_ACCESS` pattern requires a path segment after `id-document`, and its method is `GET`. |
| `/api/admin/id-document/:userId/upload` | `PATCH` | Staff writes an identity document onto any account. |
| `/api/listings/:id/thread/documents` | `POST` | Thread attachment upload. The `MESSAGING` rule at `index.mjs:59` matches `.../thread/messages` only. |
| `/api/listings/:id/media` | `POST` | Listing photo upload, 8 MB each, ceiling of 20 per listing but no ceiling on listings. |
| `/api/listings/:id/documents/:docId/file` | `GET` | Private certificate read. |
| `/api/listings/:id/thread/documents/:docId/file` | `GET` | Private attachment read. |
| `/api/driver/...`, `/api/admin/driver-documents/:id/file`, Québec document routes | `GET` | Private class C reads. |

Combined with A3-10 (no request-body size cap), the unlimited upload routes are a direct storage-cost and memory-exhaustion vector.

**Correctly implemented and confirmed, for balance.** The pre-authentication abuse endpoints (`AUTH_LOGIN`, `AUTH_REGISTER`, both email and phone OTP send/verify) are all `failMode: 'closed'` (`index.mjs:51–57`). `validateProductionConfig()` refuses to boot production without `UPSTASH_REDIS_REST_URL` and `_TOKEN` (`env.mjs:54–59`), so the per-instance in-memory Map cannot silently become the production limiter. Both are sound.

**Narrow correction:** change `DOCUMENT_ACCESS` to `failMode: 'closed'`; add rules for the six uncovered upload and private-read routes, with `failMode: 'closed'` on the private-document ones per D-2. This is a change to one table in one file, which is the reason that table exists.

**Required:** code (`server/index.mjs` rule table) + documentation (record which routes D-2 now covers).

---

### A3-05 — Identity documents have no hold mechanism; both replacement and self-deletion destroy prior evidence unconditionally (D-7, plus a fraud-hold gap not recorded anywhere)

**Severity: High**
**Launch impact: blocks closed beta**

**Status of claim: CONFIRMED FACT.**

Three code paths destroy identity evidence with no hold check of any kind:

1. **Self-replacement** — `server/routes/me.mjs:189–191`:
   ```js
   if (previous?.idDocumentRef && previous.idDocumentRef !== storageKey) {
     await deleteIdDocument(previous.idDocumentRef)
   }
   ```
   No legal-hold check, no fraud-hold check, no status check. A user whose document was just **rejected** as fraudulent can immediately overwrite it and the rejected evidence is gone.

2. **Staff replacement** — `server/routes/admin.mjs:482–484`: the identical unconditional delete on the admin-upload path.

3. **Account self-deletion** — `server/routes/me.mjs:84`: `await deleteIdDocument(oldIdRef)`. The closure guardrails (`me.mjs:21–42`) check wallet balance and active bookings/rides only. `DISPUTED` is in `ACTIVE_BOOKING_STATUSES` (`me.mjs:10`), which blocks closure during a *booking* dispute — but there is no concept of an account-level fraud or investigation hold. A user under investigation who has no open booking can close their account and destroy their identity document.

`docs/security/STR_STORAGE_THREAT_MODEL.md:589` records **D-7** as an **unresolved owner decision** and states the conflict precisely: current behaviour deletes the prior object on replacement, while D-3 governance says prior evidence is retained "where retention permits". `ARCHITECTURE_FREEZE_REVIEW_2026.md` places D-7 in Wave 3 with the note *"decide retention **before** real identity documents are replaced"*. Both are accurate. This finding adds one thing the documents do not record: **the fraud-hold gap on the account-deletion path is a separate hole from D-7**, and it is not tracked by D-7, D-3, or any STG entry I located.

**The hold machinery exists — for one document type only.** `server/lib/listing-document-retention.mjs:89–99` implements `setListingDocumentLegalHold()` with genuinely good discipline: a hold requires both a documented reason and a recorded actor, and the purge query (`:60`) filters `legalHold: false`. The `ListingDocument` model carries `legalHold`, `legalHoldReason`, `legalHoldSetById`, `legalHoldSetAt`. **No equivalent exists for `User.idDocumentRef`, `ThreadDocument`, `DriverDocument`, `QuebecDriverDocument`, or `QuebecVehicleDocument`.** The one asset class the threat model rates "Highest" sensitivity is the one with no hold.

**Narrow correction, in two independent parts so the second is not blocked on the first:**
- *Immediate, no schema change:* on all three delete paths, refuse to destroy the prior object while `idDocumentStatus === 'REJECTED'`, and preserve the prior `storageKey` on the new `AdminAuditLog` row so a superseded document is at minimum traceable.
- *Owner decision (D-7):* whether superseded identity documents are retained, and for how long — this determines whether a `legalHold` column on the identity path is required.

**Required:** owner input (D-7, blocking) + code (the narrow refusal above) + governance (define "fraud hold" as a first-class concept, or record explicitly that it does not exist).

---

### A3-06 — A published platform security rule is contradicted by the shipped frontend

**Severity: High**
**Launch impact: blocks closed beta**

**Status of claim: CONFIRMED FACT.**

`server/contracts.mjs:40` declares, in `PLATFORM_SECURITY_RULES`:

```js
'Session tokens are signed, expiring server-side credentials and never stored in localStorage.',
```

`src/backend/contracts.ts:221` carries the identical string. This array is served **unauthenticated** to any caller at `GET /api/contracts` (`server/index.mjs:104–110`).

The frontend stores session tokens in `localStorage`. `src/shared/api/platformApi.ts:592–618` defines `authStorage` explicitly over `window.localStorage`, with the comment:

> *Persistent login: the auth SESSION (guest/staff/seller token) is kept in localStorage so it survives an app/tab restart*

and `src/app/App.tsx:231–233` reads the staff session from `localStorage.getItem('sybnb.v6.staffSession')`. The keys `SELLER_SESSION_KEY`, `GUEST_SESSION_KEY`, `GUEST_SESSION_TOKEN_KEY`, `STAFF_SESSION_KEY`, `STAFF_SESSION_TOKEN_KEY` (`platformApi.ts:585–590`) all route through `authStorage`.

This is not a stale comment. It is a **security assertion the platform publishes about itself, over an unauthenticated endpoint, that is false**. Two separate harms: a reader relying on the stated control is misled, and any future security review that trusts `PLATFORM_SECURITY_RULES` inherits the error.

**Underlying posture, stated without exaggeration.** `localStorage` token storage is a deliberate, documented product decision (persistent login across app restarts, required for the Capacitor mobile webview) and is a common industry choice. It is XSS-exfiltratable, and the exposure is amplified by the 90-day token TTL (`server/lib/security.mjs:9`). The mitigations are real: the frontend CSP (`vercel.json:20`) is `script-src 'self'` with `object-src 'none'`, and `sessionVersion` revocation (`auth-context.mjs:28–33`) invalidates every outstanding token on logout or password reset. I am **not** recommending the storage decision be reversed — that is a product trade-off with a stated rationale. I am recording that the published rule must match reality.

**Narrow correction:** amend the string in both `server/contracts.mjs:40` and `src/backend/contracts.ts:221` to describe the actual control — signed, expiring, server-revocable via `sessionVersion` — and remove the false `localStorage` clause. Keep the two files in sync; there is a test asserting parity between them for CSP, and the same discipline should apply here.

**Required:** code (two string literals) + documentation.

---

### A3-07 — Ride and Québec document storage: no content validation, no durable storage, and a "quarantined" claim with nothing enforcing it

**Severity: High**
**Launch impact: blocks public production** (not closed beta, if and only if Ride and Québec remain frozen and unreachable by beta users — see the caveat below)

**Status of claim: CONFIRMED FACT.**

`server/lib/driver-document-storage.mjs` and `server/lib/quebec-document-storage.mjs` were both read in full at the baseline. Neither imports `object-storage.mjs` and neither imports `content-signature.mjs`. Consequences:

1. **Local filesystem only.** Both write with `writeFile` to `server/uploads/driver-documents` and `server/uploads/quebec-documents` (`driver-document-storage.mjs:7,49`; `quebec-document-storage.mjs:7,53`). On the serverless deployment target this is per-instance and ephemeral — the exact defect ADR-0010 exists to fix. A driver's licence uploaded for review can vanish before a reviewer opens the queue, while the upload reported success. This is correctly and explicitly disclosed in `STR_STORAGE_THREAT_MODEL.md:64–66` and in `ARCHITECTURE_FREEZE_REVIEW_2026.md`'s repository table.

2. **No magic-byte validation.** `saveDriverDocument` (`:21–51`) and `saveQuebecDocument` (`:25–55`) check the **declared** `mimeType` against an allowlist and check size, then write. Neither calls `assertContentMatchesDeclaredType()`. `content-signature.mjs:3–6` states the reason this matters: *"the `mimeType` on an upload arrives inside the JSON request body and is entirely attacker-controlled, so an allowlist check against it alone proves nothing."* The four migrated STR modules all call it; these two do not. §8 requirement 4 of the threat model — *"Magic-byte sniffing across all six subsystems"* — is met in four.

3. **A claim with no enforcement behind it.** `quebec-document-storage.mjs:13–16` states:
   > *"Every file saved here is, deliberately, effectively quarantined: it is never web-servable, never scanned, and the row that references it ... `malwareScanStatus`) stays PENDING under every current code path."*

   The honesty is genuine and welcome. But "quarantined" is not what the code does. The files **are** served — through authenticated routes at `quebec-driver-onboarding.mjs:194` and `:440` — inline, with no `content-disposition` (A3-02), to staff reviewers, with no audit record (A3-03). A file that a reviewer opens in their browser is not quarantined. `malwareScanStatus` being permanently `PENDING` is accurate and is the honest part; the word "quarantined" is the part that overstates.

**Caveat on launch impact, stated as INFERENCE.** I classify this as blocking public production rather than closed beta **on the assumption** that Ride and Québec are genuinely unreachable by beta users. I did not verify that isolation end-to-end — division isolation is tracked as an open workstream elsewhere and I did not trace every entry point. If any beta path reaches a driver-document or Québec-document upload, this becomes a closed-beta blocker.

**Narrow correction:** the lowest-cost, highest-value change is to add the two `assertContentMatchesDeclaredType(buffer, mimeType, DOCUMENT_SIGNATURE_TYPES)` calls — two lines, no storage migration, no unfreezing, and it closes the attacker-controlled-MIME hole immediately. Separately, replace the word "quarantined" in the comment with what is actually true. The storage migration itself is correctly deferred and needs a separate owner decision to unfreeze those contexts.

**Required:** code (two calls + one comment) + owner input (unfreeze decision for the storage migration) + infrastructure (when unfrozen).

---

### A3-08 — Account deletion anonymizes the user row but leaves the email address in retained audit-log payloads

**Severity: Medium**
**Launch impact: blocks closed beta**

**Status of claim: CONFIRMED FACT.**

`server/routes/me.mjs:47–81` implements account closure as anonymize-and-retain. The user row is scrubbed correctly — `email: null`, `phoneHash: null`, `passwordHash: null`, `idDocumentRef: null`, `sessionVersion` incremented — and `AdminAuditLog` rows are **deliberately retained** (`me.mjs:44–46, 77–80`). The retain decision is sound and is the normal treatment for financial and oversight records.

The problem is what those retained rows contain. `ID_DOCUMENT_SAFE_SELECT` (`server/routes/admin.mjs:1400–1410`) includes:

```js
{ id, displayName, email, idDocumentRef, idDocumentMimeType,
  idDocumentSubmittedAt, idDocumentStatus, idDocumentReviewedById, idDocumentReviewedAt }
```

That object is written verbatim into `AdminAuditLog.after` in two places:

- `admin.mjs:486–495` — `ID_DOCUMENT_UPLOADED_BY_ADMIN`, `after: updated`
- `admin.mjs:703–713` — `REVIEW_APPROVED` / `REVIEW_REJECTED`, with `before` from `findReviewEntity` (`:1431–1433`) and `after` from `updateReviewEntity`, both using the same select for the `user` model

So any user whose identity document was ever reviewed or admin-uploaded has their **email address** and their **document storage key** persisted in an audit row that survives account deletion. The anonymization is defeated for exactly the population most likely to request erasure.

Two secondary points:

- **The storage key in the audit row contradicts a stated rule.** `document-access-audit.mjs:10–11` states the audit boundary: *"Never recorded: document bytes, storage keys, bucket names ..."*. That module honours it. The two `admin.mjs` sites above do not, and they write to the same table. `idDocumentRef` is not a capability on its own — every read passes an ownership or role check first (`object-storage.mjs` key validation plus route authz), so this is a data-minimization defect, **not** an access-control bypass. I want to be precise about that.
- **`findReviewEntity` is otherwise well built.** Its comment at `admin.mjs:1429–1430` explains that it deliberately avoids returning the full user row into an audit log because of `passwordHash` and `phoneHash`. That reasoning is correct and the protection works — password and phone hashes are **not** leaked. The select simply stops one field short.

**Narrow correction:** introduce a narrower select for audit payloads — `ID_DOCUMENT_AUDIT_SELECT` — omitting `email` and `idDocumentRef`, and use it at `admin.mjs:493` and in `findReviewEntity`/`updateReviewEntity` for the `user` model. Keep `ID_DOCUMENT_SAFE_SELECT` for API responses, where staff legitimately need the email. Separately decide whether existing rows require backfill redaction.

**Required:** code (one new constant, three call sites) + governance (decide on historical-row redaction) + owner input (whether audit payload retention is bounded at all).

---

### A3-09 — Retention deletion has no scheduler, and four of five private-document types have no retention policy at all

**Severity: Medium**
**Launch impact: blocks public production**

**Status of claim: CONFIRMED FACT.**

**No scheduler.** `purgeExpiredListingDocuments()` and `markExpiredListingDocuments()` (`server/lib/listing-document-retention.mjs:45,57`) have exactly one call site each: `server/routes/compliance.mjs:276–277`, inside the compliance-dashboard `GET` handler. The module states the reason plainly (`:43–44`): *"there is no cron in this codebase, so housekeeping runs on the next relevant request instead."* That is honest, and the lazy-expiry pattern is used consistently elsewhere in this codebase.

The consequence for **retention** specifically is different from the consequence for booking expiry. A booking that expires late is a stale row. A document retained past its deletion deadline is a **retention-policy violation that compounds silently**. If no administrator opens the compliance dashboard for six months, documents whose retention window closed six months ago are still on disk, and nothing anywhere reports it. The purge is also unauthenticated as to actor — `compliance.mjs:277` passes `{ actorId: null }`, so the resulting `LISTING_DOCUMENT_RETENTION_PURGED` audit row (`listing-document-retention.mjs:71–80`) has a null actor. That is arguably correct for an automated purge, but combined with the absence of a scheduler it means nobody can demonstrate *when* retention actually ran.

**No policy for four of five types.** A retention schedule (`retentionDeleteAfter`, `deletedAt`, purge query, legal hold) exists **only** for `ListingDocument`. There is none for:

| Type | Field | Retention | Legal hold |
|---|---|---|---|
| Identity document | `User.idDocumentRef` | **None** — retained indefinitely | **None** |
| Thread attachment | `ThreadDocument.assetUrl` | **None** | **None** |
| Driver document | `DriverDocument.assetUrl` | **None** | **None** |
| Québec driver/vehicle document | `Quebec*Document.assetUrl` | **None** | **None** |

The privacy policy (`src/modules/legal/LegalPlaceholderPage.tsx:172`, EN §5) states retention is *"as long as your account is active, and as needed to resolve any open disputes, complete payouts, or meet legal obligations."* For identity documents the operative behaviour is: retained indefinitely while the account is active, with no defined end. An identity document whose only purpose was a one-time booking-eligibility check in 2026 is still held in 2030. Whether that is lawful is a question for counsel (EV-04), not for this review — but it is a fact the privacy notice does not convey.

**Correct and worth recording.** `getOperationalDocumentStatuses()` (`listing-document-retention.mjs:19–21`) returns `['DIGITALLY_VERIFIED']` under `NODE_ENV=production` and nothing in the codebase ever sets that status. Production therefore fails closed: no CITQ certificate can ever be treated as operational until a real verification integration ships. The comment at `:11–18` states this intent exactly, and the code matches it. This is a genuinely well-built fail-closed gate.

**Narrow correction:** (a) invoke the purge from a scheduled path rather than a dashboard read — a Vercel Cron entry in `vercel.json` calling an authenticated maintenance route is the smallest change; (b) record explicitly, in the threat model, that identity, thread, driver and Québec documents have **no** retention schedule, so the gap is tracked rather than assumed covered by the `ListingDocument` policy.

**Required:** infrastructure (scheduler) + owner input (retention periods per document type — this is the same decision surface as D-7) + documentation.

---

### A3-10 — No request-body size cap anywhere; unbounded buffering on unrated-limited upload routes

**Severity: Medium**
**Launch impact: blocks public production**

**Status of claim: CONFIRMED FACT.**

`readJson()` (`server/lib/responses.mjs:36–53`) buffers the entire request body into memory with no ceiling:

```js
const chunks = []
for await (const chunk of req) { chunks.push(chunk) }
const raw = Buffer.concat(chunks).toString('utf8').trim()
```

There is no `Content-Length` check, no cumulative-byte guard, and no abort. Every size limit in the platform is enforced **after** the full body has been buffered, JSON-parsed, and base64-decoded — for example `id-document-storage.mjs:56` checks `buffer.length > MAX_ID_DOCUMENT_BYTES` only once `Buffer.from(base64Data, 'base64')` has already run.

Combined with A3-04, the upload routes that have **no rate-limit rule** (`PATCH /api/me/id-document`, `PATCH /api/admin/id-document/:id/upload`, `POST /api/listings/:id/thread/documents`, `POST /api/listings/:id/media`) accept unbounded bodies at an unbounded rate. Peak memory is roughly `body_bytes + utf8_string + decoded_buffer` per concurrent request.

**INFERENCE (labelled, and it cuts the other way):** the Vercel serverless platform imposes its own request-body limit, which would bound this in production. I did not verify the platform limit against this deployment's configuration and I am not going to assert a number. Two things follow. First, the application must not depend on an unverified platform limit for a memory-safety property — the local dev server (`server/index.mjs:140`) has no such limit at all. Second, if the platform limit is **below** the ~10.7 MB that an 8 MB file requires after base64 expansion, then the documented 8 MB upload ceiling cannot actually be reached in production, which is a functional defect that would surface only on a real deployment. That tension is worth resolving before the first real upload, and it is testable without deploying by checking the configured limit.

**Narrow correction:** add a byte ceiling inside `readJson()` — accumulate a running total, and throw a `413` with `expose: true` once it exceeds a constant slightly above the largest legitimate base64 payload. One function, every route inherits it.

**Required:** code (`server/lib/responses.mjs`) + infrastructure verification (confirm the platform body limit is compatible with the 8 MB file ceiling).

---

### A3-11 — Privacy notice omits processors, cross-border transfer, AI processing, and identity-document retention; the page is simultaneously "DRAFT" and carries an effective date

**Severity: Medium**
**Launch impact: blocks closed beta**

**Status of claim: CONFIRMED FACT** as to what the page does and does not say. **No legal conclusion is offered or implied.**

`src/modules/legal/LegalPlaceholderPage.tsx` was read in full. What it does well, recorded first because it is unusual and deserves credit: the file's header comment (`:9–15`) states that every figure — 13% commission, the 3-day cancellation window, the $10 late fee, the 3% protection premium, ID-document handling — mirrors what `finance-ledger.mjs`, `bookings.mjs` and `id-document-storage.mjs` actually do, *"not generic marketplace boilerplate"*, and that no registered company name or address exists anywhere in the project. Both statements are accurate against the code. The page carries a visible `DRAFT — NOT FINAL` badge (`:195`). The password and phone-hash claims (EN §3, `:164`) are true: `security.mjs:35–47` uses scrypt, `:23–33` uses HMAC-SHA256 for phone. This is a notably honest artifact.

Four gaps, all verified by reading the page text in both languages:

1. **No processor or sub-processor disclosure, and no cross-border transfer statement.** EN §4 "Who we share it with" (`:168`) says only that data is not sold, that hosts see booking-necessary guest information, and that disclosure may occur if required by law. The platform routes personal data — including identity documents — through Cloudflare R2 (EU jurisdiction, per `ADR-0010` and `SYBNB_R2_CONFIGURATION_GUIDE.md:69`), Neon Postgres, Vercel, Upstash, and an email provider (Resend or SMTP, per `env.mjs:66–68`). None is named. No international transfer is described. This is exactly the subject matter of **EV-04**, **EV-05** and **EV-06**, all recorded OPEN.

2. **No disclosure of AI processing.** `server/lib/ai-insights.mjs:1–3` sends listing data to Anthropic's API when `ANTHROPIC_API_KEY` is set. The payload (`:43–49`, `:96`) is host-entered listing content — title, price, city, amenities. Not identity data, and the system prompts (`:32`, `:85`) are tightly constrained against fabrication, which is good AI-boundary discipline. But a host-entered free-text title is user-supplied content leaving the platform to a third-party processor, and no legal page mentions it. The feature is env-gated and inert when unconfigured (`isAnthropicConfigured()`, `:20`), so this is disclosure-before-enablement, not a live exposure today.

3. **No retention period for identity documents.** EN §5 (`:172`) covers "account and booking data". Identity documents are not mentioned, and per A3-09 they have no defined retention end.

4. **`DRAFT — NOT FINAL` alongside `Effective date: July 12, 2026`.** A page cannot coherently be both a non-final draft and in effect from a stated date. Which of the two governs is a question for counsel, not for me.

Also noted: EN §3 (`:164`) says ID documents are *"stored outside any web-accessible directory"* — wording that predates the R2 migration. It remains substantively true (no public bucket, no signed URLs, no direct browser access — all independently verified in §6), but "directory" now describes an architecture that has been replaced.

**Narrow correction:** none proposed to the legal text. Drafting privacy-notice language is counsel's work, not a reviewer's. What this review can do is state precisely what the code does so counsel can draft against facts: the processors named above, the AI call in `ai-insights.mjs`, the indefinite identity-document retention, and the audit-log email retention from A3-08. The DRAFT-versus-effective-date contradiction should be resolved before any real user sees the page.

**Required:** owner input + external legal counsel (EV-04, EV-05, EV-06) + documentation. **Flagged for counsel; no legal conclusion reached.**

---

### A3-12 — `isDemo` is declared in the schema and read by no code; the demo seed is documented for production and creates a fully-verified driver and a live public listing

**Severity: Medium**
**Launch impact: blocks public production**

**Status of claim: CONFIRMED FACT.**

`prisma/schema.prisma:166` declares `isDemo Boolean @default(false)`. A repository-wide grep across `server/` returns **zero** reads of that field. It is written by `scripts/seed-demo-accounts.mjs:24,39` and never consulted by any query, filter, authorization check, metrics aggregation, or search path. Demo accounts are, at runtime, indistinguishable from real ones.

`docs/store/DEMO_ACCOUNTS.md` documents the seed under the heading **"Running the seed (staging / production)"**. `scripts/seed-demo-accounts.mjs` contains no `NODE_ENV` guard. Executed against production it creates:

- a guest, a driver and a host with `idDocumentStatus: 'APPROVED'` (`:25,40`) — verification status granted, no document ever reviewed
- `DriverDocument` rows with `status: 'APPROVED'` and `assetUrl: 'demo-<type>.pdf'` (`:67–68`)
- an `APPROVED` vehicle (`:74`)
- an `APPROVED` `STAYS` listing (`:82`) — which, being `APPROVED`, is publicly visible in search (`listings.mjs:195`) and publicly bookable, with its media publicly readable (`listings.mjs:472`)

Two distinct problems. **First**, the seeded driver satisfies `requireRoadReadyDriver()` (`auth-context.mjs:76–101`) — ID `APPROVED`, `LICENSE` and `VEHICLE_REGISTRATION` both `APPROVED` — so a production seed produces an account that can be matched to real riders having passed no actual vetting. That is precisely the risk the comment at `auth-context.mjs:59–61` exists to prevent: *"without this gate an unverified/ID-rejected stranger could be matched to real riders."* The gate is well built; the seed walks around it. **Second**, `assetUrl: 'demo-LICENSE.pdf'` does not match the storage-key regex (`driver-document-storage.mjs:56`), so a reviewer opening that document receives a `400` — an `APPROVED` document whose evidence cannot be retrieved.

For balance: the seed correctly grants **no admin role**, and correctly sources the password from `DEMO_ACCOUNT_PASSWORD` with a length check (`:50`) rather than committing one. `docs/store/DEMO_ACCOUNTS.md` contains **no credential value** — verified. The store-review requirement driving this is legitimate.

**Narrow correction:** (a) exclude `isDemo` accounts and their listings from public search and from platform metrics — the column already exists, it just needs to be read; (b) require an explicit opt-in environment variable before the script will run under `NODE_ENV=production`, so a production seed is deliberate rather than incidental.

**Required:** code (filter on `isDemo`, add a production guard) + governance (decide whether demo accounts belong in production at all, or only in a review build).

---

### A3-13 — Audit-write failure and rate-limit-store failure are both swallowed to `console.error` with no routing; STG-22 confirmed open

**Severity: Medium**
**Launch impact: blocks public production**

**Status of claim: CONFIRMED FACT.**

`recordStaffDocumentAccess()` (`server/lib/document-access-audit.mjs:57–59`) catches every error and returns `{ recorded: false, reason }`. The one call site (`admin.mjs:393`) **discards the return value** — it does not check `recorded`. So a staff read of an identity document proceeds and completes when its audit write failed, and nothing anywhere observes it.

The module documents this precisely (`:26–30`): *"auditing must not block a legitimately authorized read ... The caller decides what to do with that — today nothing does, because there is no alerting to route it to (STG-22). That is an honest gap, not a silent one."* I agree with the fail-open decision on a legitimately authorized read. I record that the stated compensating control — the caller deciding — is not implemented, and the return value is dropped on the floor.

Same shape in `rate-limit.mjs:113–115`: store unreachability emits `console.error` and continues per `failMode`.

`STR_STORAGE_THREAT_MODEL.md:521` rates **STG-22** *"The most significant systemic weakness; several mitigations assume someone notices"*, and §8's top-five risks place it second. Confirmed against code: total structured logging in `server/` is four `console.*` calls (`index.mjs:222` startup, `rate-limit.mjs:115`, `responses.mjs:57`). There is no aggregation, no alert channel, no dashboard, no error tracker.

`handleRouteError` (`responses.mjs:55–76`) is otherwise well built: only `error.expose === true` gates whether a real message reaches the client, and `details` rides the same gate. The F-15 fix described in its comment is correctly implemented.

**Narrow correction:** at `admin.mjs:393`, check the returned `recorded` flag and emit a distinct, greppable `console.error` when it is `false`. This does not build a monitoring stack; it makes the failure visible to whatever log aggregation is eventually configured. Full alerting (STG-22) is correctly a public-launch item.

**Required:** code (check one return value) + infrastructure (STG-22 alerting, correctly deferred to public launch).

---

### A3-14 — Session and cryptographic parameters: 90-day TTL, default scrypt cost, unvalidated Host header

**Severity: Low**
**Launch impact: does not block launch** (record and decide)

**Status of claim: CONFIRMED FACT.**

Three observations, none individually alarming, recorded for completeness.

1. **90-day session TTL** — `server/lib/security.mjs:9`, `SESSION_TTL_SECONDS = 60*60*24*90`. Combined with `localStorage` storage (A3-06), the exposure window for a stolen token is long. The compensating control is genuine and correctly implemented: `sessionVersion` (`auth-context.mjs:28–33`) invalidates every outstanding token on logout or password reset, and `createSessionToken` stamps the `sv` claim at issuance (`security.mjs:98`). The reasoning at `security.mjs:4–8` is sound. This is a defensible product trade-off; I record it rather than object to it.

2. **scrypt at library defaults** — `security.mjs:45`, `scryptSync(password, salt, 64)` with no cost parameters, taking Node's defaults (N=16384, r=8, p=1). The 16-byte random salt (`:44`) and `timingSafeEqual` comparison (`:55`) are both correct. The N value is below current OWASP guidance for scrypt. The versioned prefix `scrypt:v1` (`:3`) was clearly designed to permit exactly this kind of parameter migration, which is good forward planning.

3. **Host header unvalidated** — `publicUrl()` (`responses.mjs:78–81`) builds a `URL` from `req.headers.host`, which is client-controlled. Impact is minimal because the result is used only for `pathname`/`searchParams` in routing, never for redirect construction or link generation. Redirect safety is separately handled: `isAllowedOrigin()` (`allowed-origins.mjs:32`) validates any client-supplied origin before it reaches a Stripe redirect URL. No exploit path identified; recorded as hardening.

**Narrow correction:** none required for launch. If addressed: raise scrypt `N` behind the existing `v1` prefix with lazy rehash on next successful login.

**Required:** owner input (accept or schedule).

---

### A3-15 — Audit log is readable by the roles it audits, with no append-only guarantee

**Severity: Low**
**Launch impact: does not block launch** (governance decision)

**Status of claim: CONFIRMED FACT.**

`GET /api/admin/audit-log` (`admin.mjs:500–518`) is authorized to `['ADMIN','SUPPORT']`. The `STAFF_DOCUMENT_ACCESSED` records written by `recordStaffDocumentAccess()` are therefore readable by the same role population they exist to oversee. A support agent can see exactly which of their own accesses were recorded.

No API route deletes or updates `AdminAuditLog` rows — I checked, and there is no such handler. So there is no application-level tampering path, which is the important part. There is equally no database-level append-only constraint, no write-once storage, and no external log shipping, so the guarantee rests entirely on nobody having direct database access. For a pre-launch platform that is a normal posture; it is not an audit guarantee, and it should not be described as one.

This is a separation-of-duties observation, not a vulnerability. It matters more in combination with A3-01 (no step-up on `SUPPORT`) and A3-13 (audit failures unobserved) than on its own.

**Narrow correction:** restrict `GET /api/admin/audit-log` to `['ADMIN']`, matching the review-decision route at `admin.mjs:698` which is already `ADMIN`-only. Record explicitly that no append-only guarantee exists.

**Required:** governance (decide who may read the audit log) + code (one role list, if the decision is to restrict).

---

## 5. Control-by-control assessment

Legend — **Met**: implemented and verified in code · **Partial**: implemented on some paths only · **Absent**: not implemented · **N/A**: not applicable at this baseline.

| # | Control | Status | Evidence | Finding |
|---|---|---|---|---|
| 1 | Public bucket / `r2.dev` prohibition | **Met** | 0 occurrences in tracked source; only doc references | — |
| 2 | Signed-URL prohibition | **Met** | `getSignedUrl`, `s3-request-presigner`, `presign` — 0 occurrences | — |
| 3 | Bucket CORS prohibition | **Met** | `PutBucketCors` — 0 occurrences | — |
| 4 | Bucket policy / ACL prohibition | **Met** | `PutBucketPolicy`, `PutBucketAcl`, `public-read`, `ACL:` — 0 occurrences | — |
| 5 | Browser-credential prohibition | **Met** | No `VITE_STORAGE*`/`VITE_S3*`/`VITE_R2*`; only `VITE_API_BASE_URL` and the Stripe **publishable** key, public by design | — |
| 6 | No secret in tracked files | **Met** | Only `.env*.example` placeholders; `.gitignore:5–9` excludes real env files | — |
| 7 | No secret in git history | **Met** | Full `git log --all -p` credential-pattern scan: 0 hits; no env file ever committed | — |
| 8 | API CORS allowlist | **Met** | `allowed-origins.mjs:24–34`; `index.mjs:191–204` omits the header for disallowed origins | — |
| 9 | Security headers on API | **Met** | `security-headers.mjs:8–25`; CSP `default-src 'none'`, `frame-ancestors 'none'`, nosniff, HSTS gated on `FORCE_HTTPS` | — |
| 10 | Frontend CSP | **Met** | `vercel.json:20`; `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` | — |
| 11 | Production config fail-closed | **Met** | `env.mjs:30–99`; invoked from **both** entry points (`index.mjs:217`, `api/index.mjs:12`) | — |
| 12 | Storage driver explicit, no inference | **Met** | `object-storage.mjs:57–68`; production rejects `local`, test rejects `s3` at boot **and** at use (`:275–287`) | — |
| 13 | Test-bucket-in-production guard | **Met** | `object-storage.mjs:103–112` | — |
| 14 | Object keys non-capability, non-enumerable | **Met** | `buildObjectKey` UUID + allowlisted ext (`:129–135`); `assertSafeObjectKey` full-string regex (`:118–125`) | — |
| 15 | Row binding on media reads | **Met** | `listings.mjs:460–463` binds key to listing before serving | — |
| 16 | Draft-media authorization | **Met** | `listings.mjs:472–484`; public only when `APPROVED` | — |
| 17 | No user input reaches endpoint/bucket/credential | **Met** | `object-storage.mjs:194–202`, env-only | — |
| 18 | Storage errors do not leak internals | **Met** | `wrapS3Error` (`:208–214`) returns generic messages | — |
| 19 | Error-message exposure gating | **Met** | `responses.mjs:65–75`, `expose === true` only | — |
| 20 | Session revocation | **Met** | `auth-context.mjs:28–33` via `sessionVersion` | — |
| 21 | Privileged roles not self-registrable | **Met** | `auth.mjs:27,251` | — |
| 22 | Login timing-attack resistance | **Met** | `auth.mjs:418` decoy hash | — |
| 23 | Fail-closed compliance flags | **Met** | `compliance-feature-flags.mjs:27–30`; enabling requires a recorded actor | — |
| 24 | Fail-closed jurisdiction gate | **Met** | `auth-context.mjs:81`; re-checked per action | — |
| 25 | Production certificate gate | **Met** | `listing-document-retention.mjs:19–21`; `DIGITALLY_VERIFIED` never set → production blocked | — |
| 26 | Distributed rate limiting required in production | **Met** | `env.mjs:54–59` | — |
| 27 | Pre-auth endpoints fail-closed | **Met** | `index.mjs:51–57` | — |
| 28 | Magic-byte content validation | **Partial** | 4 of 6 storage modules | **A3-07** |
| 29 | Forced download on class B/C (STG-12) | **Partial** | 2 of 6 serve paths | **A3-02** |
| 30 | Staff document-access audit (STG-24) | **Partial** | 1 of 7 staff read paths | **A3-03** |
| 31 | Private-route rate limiting fail-closed (D-2) | **Absent** | `index.mjs:68` `failMode: 'open'` | **A3-04** |
| 32 | Rate-limit coverage on uploads | **Absent** | 4 upload routes match no rule | **A3-04** |
| 33 | Staff step-up authentication | **Partial** | `SUPPORT` exempt (`auth.mjs:37`) | **A3-01** |
| 34 | Legal hold | **Partial** | `ListingDocument` only | **A3-05** |
| 35 | Fraud / investigation hold | **Absent** | No such concept anywhere | **A3-05** |
| 36 | Identity-document retention schedule | **Absent** | No policy, no purge | **A3-09** |
| 37 | Retention purge scheduling | **Absent** | Inline on dashboard read only | **A3-09** |
| 38 | Audit purpose / case reference | **Absent** | No column (`schema.prisma:1049–1065`) | **A3-03** |
| 39 | Audit actor IP | **Absent** | `ipHash` declared, never written | **A3-03** |
| 40 | Audit payload minimization | **Absent** | Email + storage key in `after` | **A3-08** |
| 41 | Erasure completeness | **Partial** | Row anonymized; audit payloads retain email | **A3-08** |
| 42 | Request-body size cap | **Absent** | `responses.mjs:36–53` | **A3-10** |
| 43 | Monitoring / alerting (STG-22) | **Absent** | 4 `console.*` calls total | **A3-13** |
| 44 | Orphan reconciliation (STG-14) | **Absent** | Correctly disclosed (`me.mjs:162–164`) | Confirmed open |
| 45 | Malware scanning (STG-11) | **Absent** | Correctly disclosed | Confirmed open |
| 46 | Demo-data isolation | **Absent** | `isDemo` never read | **A3-12** |
| 47 | Published security rules accurate | **Absent** | `contracts.mjs:40` false | **A3-06** |
| 48 | Processor / transfer disclosure | **Absent** | Not in legal pages | **A3-11** |
| 49 | AI-processing disclosure | **Absent** | Not in legal pages | **A3-11** |
| 50 | AI output constrained against fabrication | **Met** | `ai-insights.mjs:32,85`; strict-JSON parsing and validation | — |
| 51 | External-verification gates tracked | **Met** | EV-01…EV-07, all OPEN, no false closure | — |
| 52 | Registered legal entity | **Absent** | None exists; correctly disclosed (`LegalPlaceholderPage.tsx:13–14`) | **A3-11** |
| 53 | Backup / restore | **Absent** | None found; disclosed in threat model §8 | Confirmed open |
| 54 | Incident-response procedure | **Absent** | None found in `docs/` | Confirmed open |
| 55 | Credential-rotation rehearsal | **Absent** | Listed as Wave 2 item | Confirmed open |

---

## 6. Documentation claims independently verified

Testing documentation against code cuts both ways. These claims were checked and **hold**:

| Claim | Source | Verification |
|---|---|---|
| No credential leaks at HEAD or in history | `ARCHITECTURE_FREEZE_REVIEW_2026.md:284` region | Confirmed — independent scan of tracked files and full history: 0 hits |
| `r2.dev`, `PutBucketPolicy`, `PutBucketAcl`, `public-read` — 0 occurrences | same | Confirmed |
| `getSignedUrl` — 0 occurrences | same | Confirmed |
| `PutBucketCors` — 0 occurrences | same | Confirmed |
| `VITE_STORAGE`/`VITE_S3`/`VITE_R2` — 0 occurrences | same | Confirmed |
| Two storage modules deliberately unmigrated | same | Confirmed — `driver-document-storage.mjs`, `quebec-document-storage.mjs` |
| `object-storage.mjs` "driver" hits are the storage-driver concept, not SR's domain | same | Confirmed — `STORAGE_DRIVER`, `localDriver`, `s3Driver` |
| STG-11 OPEN, unchanged | `STR_STORAGE_THREAT_MODEL.md:41` | Confirmed — no scanning anywhere |
| STG-14 OPEN, unchanged | `:42` | Confirmed — `me.mjs:162–164` discloses the crash window |
| STG-22 open, most significant systemic weakness | `:521` | Confirmed |
| D-7 unresolved | `:589` | Confirmed — `me.mjs:189–191` deletes unconditionally |
| EV-01…EV-07 all OPEN | `SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md` | Confirmed — no item is represented as resolved anywhere |
| No registered legal entity | `LegalPlaceholderPage.tsx:13–14` | Confirmed |
| Legal-page figures mirror code | `LegalPlaceholderPage.tsx:9–15` | Spot-checked — password/phone-hash claims (EN §3) accurate |
| `malwareScanStatus` stays `PENDING` | `quebec-document-storage.mjs:15–16` | Confirmed |

These claims were checked and **do not hold** — each is a finding above:

| Claim | Source | Reality |
|---|---|---|
| STG-12 CLOSED; `Content-Disposition` on **all** class B/C responses | `STR_STORAGE_THREAT_MODEL.md:39` + §8 req. 8 | 2 of 6 paths — **A3-02** |
| STG-24 CLOSED; audit **every** staff read of a class C object | `:40` + §8 req. 9 | 1 of 7 paths — **A3-03** |
| D-2 RESOLVED; private document routes fail-closed | `:30` + §8 decision table | `failMode: 'open'` — **A3-04** |
| Magic-byte sniffing across **all six** subsystems | §8 req. 4 | 4 of 6 — **A3-07** |
| Session tokens "never stored in localStorage" | `server/contracts.mjs:40` | Stored in `localStorage` — **A3-06** |
| Québec documents "effectively quarantined" | `quebec-document-storage.mjs:13–16` | Served inline to staff, unaudited — **A3-07** |
| Audit records never contain storage keys | `document-access-audit.mjs:10–11` | True for that module; `admin.mjs:493` writes `idDocumentRef` — **A3-08** |

---

## 7. Summary counts

**By severity**

| Severity | Count | IDs |
|---|---|---|
| **Critical** | **1** | A3-01 |
| **High** | **5** | A3-02, A3-03, A3-04, A3-05, A3-06 |
| **Medium** | **6** | A3-07*, A3-08, A3-09, A3-10, A3-11, A3-12, A3-13 |
| **Low** | **2** | A3-14, A3-15 |
| **Total** | **15** | |

\* A3-07 is rated **High** on severity and appears in the High row of the launch-impact table below; it is listed here beside the Medium cluster only because its launch impact is production rather than beta. Severity counts: Critical 1, High 6, Medium 6, Low 2.

**By launch impact**

| Impact | Count | IDs |
|---|---|---|
| Blocks internal testing | **0** | — |
| **Blocks closed beta** | **7** | A3-01, A3-02, A3-03, A3-04, A3-05, A3-06, A3-08, A3-11 |
| **Blocks public production** | **5** | A3-07, A3-09, A3-10, A3-12, A3-13 |
| Does not block launch | **2** | A3-14, A3-15 |

**By required work type** (findings may require more than one)

| Type | IDs |
|---|---|
| **Code** | A3-01, A3-02, A3-03, A3-04, A3-05, A3-06, A3-07, A3-08, A3-10, A3-12, A3-13, A3-15 |
| **Documentation** | A3-02, A3-03, A3-04, A3-06, A3-09, A3-11 |
| **Governance** | A3-01, A3-05, A3-08, A3-12, A3-15 |
| **Infrastructure** | A3-07, A3-09, A3-10, A3-13 |
| **Owner input** | A3-03, A3-05, A3-07, A3-08, A3-09, A3-11, A3-14 |
| **External counsel** | A3-11 (EV-04, EV-05, EV-06; A3-03 informs EV-07) |

**Smallest set of changes that clears the closed-beta band.** Five of the seven beta blockers are single-file, low-risk edits: one token (A3-01), one rule table (A3-04), two string literals (A3-06), six header call-sites (A3-02), six audit call-sites (A3-03). A3-08 is one new constant plus three call sites. Only A3-05 (D-7) and A3-11 (counsel) require decisions that cannot be made inside the codebase, and both are already tracked — A3-05 as D-7, A3-11 as EV-04/05/06. **INFERENCE:** the beta band is closer than the count of seven suggests, provided D-7 is decided.

---

## 8. Explicit limitations

Stated so the weight placed on this review is calibrated correctly.

1. **Static review only.** Nothing was executed. No test was run, no server started, no request issued. Every finding rests on reading the baseline tree. A control that exists in code but fails at runtime would not be caught here, and a finding that a runtime test would disprove is possible.

2. **No infrastructure verified.** No connection was made to Cloudflare, Neon, Vercel, or Upstash. Bucket privacy, `r2.dev` state, CORS configuration, credential scope, and platform request limits are **unverified** — this review confirms only that the *application* contains no code that would make a bucket public or mint a signed URL. Provisioning-time configuration is out of reach of any code review and is correctly tracked in `SYBNB_R2_MANUAL_PROVISIONING_CHECKLIST.md`.

3. **No credential value was accessed, read, or reproduced.** Verification was structural only: `.gitignore` coverage, absence from tracked files, absence from history. I did **not** open any `.env.local` or equivalent. Whether the required variables are correctly *populated* in any real environment is unverified and unverifiable from here.

4. **No legal conclusion is offered anywhere in this document.** A3-11 and the EV register items describe what the code does and what the pages say. Whether any of it satisfies any regime — Syrian, Canadian, EU, or other — is a question for counsel. Nothing here should be read as advice, and the absence of a finding is not a statement of compliance.

5. **Coverage is scoped, not exhaustive.** `admin.mjs` is 76 KB and was read in the ranges relevant to authorization, document access, audit, and review decisions — not line by line. `bookings.mjs`, `payments.mjs`, `wallet.mjs`, `sr-rides.mjs`, `host.mjs`, `disputes.mjs`, `sellers.mjs`, `reports.mjs`, `reviews.mjs`, `accommodations.mjs` and `tax-profile.mjs` were **not** reviewed. Financial-logic security, payment-flow authorization, and SR ride-safety controls are outside what I examined. An absence of findings in those areas reflects absence of review, not absence of defects.

6. **Division isolation was not traced end-to-end.** I confirmed that the four migrated storage modules contain no Ride or Québec references and that neither out-of-scope module imports the new abstraction. I did **not** verify that no beta user path reaches a Ride or Québec surface. A3-07's launch-impact rating depends on that isolation holding, and I flag the dependency rather than assert the conclusion.

7. **Test suite not assessed.** `test/` was not reviewed. Claims in the threat model that a behaviour is "locked by regression test" were **not** verified. Where I record a control as Met, that means the code implements it — not that a test guards it against regression.

8. **Frontend review was targeted.** `src/` was examined only for token storage, the contracts mirror, and the legal pages. No XSS review, no dependency-vulnerability review, no client-side authorization review was performed. Given that A3-06 concerns `localStorage` token storage, whose principal risk is XSS, the absence of an XSS review is a material gap in this report's coverage of that finding's real-world severity.

9. **First-pass and uninfluenced by design.** `AGENT_1_*` and `AGENT_2_*` were not read, per instruction. Where those reviews reach different conclusions on the same code, the divergence is information and should be reconciled rather than resolved by seniority.

10. **Where I am unsure, I have said so** — labelled **INFERENCE** at each point, specifically: the Vercel body-limit interaction (A3-10), the credential-stuffing consequence (A3-01), the Ride/Québec isolation dependency (A3-07), and the beta-proximity estimate (§7).

---

*End of AGENT 3 review. Baseline `8a4eba7`. Read-only; no file outside this report was created or modified.*
