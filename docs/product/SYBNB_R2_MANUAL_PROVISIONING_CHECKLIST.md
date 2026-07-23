# SYBNB — R2 Manual Provisioning Checklist (owner-executed)

**Date:** 2026-07-22
**Executed by:** the platform owner, **manually**. No Cloudflare resource is created by automation.

> ## [OWNER DECISION 2026-07-22 — SCOPE NARROWED TO TEST ONLY]
>
> Test infrastructure provisioning is **authorized**. Nothing else is.
>
> **Approved for immediate creation — two buckets only:**
> - `sybnb-test-media`
> - `sybnb-test-documents`
>
> **Approved credential:** **one** test-only least-privilege credential scoped to those two buckets.
> Permitted capabilities: object read · object write · object delete **only if required** by the approved
> test and replacement flows · bucket listing **only if technically required and narrowly scoped**.
> **No account-wide administrative token.**
>
> **Do NOT provision or inject staging or production credentials.** Staging and production buckets may be
> created later under their own gates; §3 below still lists all six for reference, but **only the two test
> buckets are authorized now**.
>
> **Public launch remains blocked** — see `SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md` (EV-01…EV-07, all
> OPEN) and the public-launch blockers in `docs/security/STR_STORAGE_THREAT_MODEL.md`.
>
> **After provisioning, Claude performs a read-only, redacted configuration verification only** (§ *Post-
> provisioning verification* below). **No object will be uploaded and no connection attempted** until the
> implementation gate is explicitly reopened.

**Original scope of this run (superseded above):** ~~create all six buckets · inject TEST credentials only.~~

> **This checklist contains no secrets and no example credentials.** Every credential is a named
> placeholder. **Never paste a secret into chat, a commit, a ticket, a screenshot, or any document.**

**Approved configuration being provisioned**

| Setting | Value |
|---|---|
| Provider | Cloudflare R2 |
| Jurisdiction | **`eu` (European Union) — all six buckets** |
| Endpoint form | `https://<R2_ACCOUNT_ID>.eu.r2.cloudflarestorage.com` |
| Region value | `auto` |
| Bucket access | Fully private |
| Public dev URL (`r2.dev`) | Disabled |
| Custom domain | None |
| Bucket CORS | None |
| Lifecycle | Abort incomplete multipart uploads after 1 day only |

---

## 1. Confirm the correct Cloudflare account

- [ ] Signed in to the **intended SYBNB Cloudflare account** (not a personal or unrelated account)
- [ ] R2 is enabled on the account (billing enabled, even within the free allowance)
- [ ] 2FA is enabled on this account
- [ ] Account ID captured for the endpoint — **treat as configuration, do not publish**

## 2. Confirm EU jurisdiction before creating each bucket

- [ ] Understood: **jurisdiction is set at creation and cannot be changed afterwards** — a change requires a new bucket and a full object copy
- [ ] For **every** bucket, "Specify jurisdiction" → **European Union** is selected **before** clicking create
- [ ] Understood: a location *hint* is not a jurisdiction. Do not select a hint instead

## 3. Create all six approved buckets

Create each in the **EU jurisdiction**. Use these names **exactly** — no abbreviations, no substitutions:

- [ ] `sybnb-test-media`
- [ ] `sybnb-test-documents`
- [ ] `sybnb-staging-media`
- [ ] `sybnb-staging-documents`
- [ ] `sybnb-production-media`
- [ ] `sybnb-production-documents`

**If any name is unavailable in the account: STOP.** Report the conflict and wait for approval. **Do not
choose an alternative name.**

## 4. Verify the public development URL is disabled

For **each** of the six buckets:

- [ ] `r2.dev` public development URL is **disabled**
- [ ] Confirmed on the bucket's own settings page, not assumed from the default

> Cloudflare: buckets are private by default and "will always require explicit user permission to enable"
> public access. This step confirms nobody enabled it.

## 5. Verify no custom domain is attached

- [ ] No custom domain on any of the six buckets
- [ ] Understood: a custom domain serves bucket objects publicly and would bypass every application authorization check

**Highest-severity item in this checklist:** `sybnb-production-documents` must never be publicly
accessible. Public access there would expose every host and guest identity document to anyone holding or
guessing an object key.

## 6. Verify no bucket CORS policy exists

- [ ] No CORS policy configured on any of the six buckets
- [ ] Understood: the browser never contacts R2 directly, so bucket CORS is unnecessary — and enabling it would signal an access pattern that does not exist

## 7. Configure incomplete-multipart cleanup only

- [ ] Lifecycle rule: **abort incomplete multipart uploads after 1 day**, on each bucket (where the setting is available)
- [ ] No other lifecycle rule added

## 8. Confirm no age-based deletion

- [ ] **No age-based object expiry on any media or documents bucket**
- [ ] Understood: application retention governance (`server/lib/listing-document-retention.mjs`) is authoritative and includes **legal hold**. A bucket expiry rule could delete bytes while a legal hold, dispute, or audit still requires them

*Optional, test only:* a short expiry on the two `sybnb-test-*` buckets is acceptable so verification
artefacts do not accumulate. **Never on staging or production.**

## 9. Create three separate scoped credentials

Under **R2 → Manage R2 API Tokens**:

- [ ] `sybnb-test-storage` created
- [ ] `sybnb-staging-storage` created
- [ ] `sybnb-production-storage` created
- [ ] Three separate tokens — **not one shared token**
- [ ] Expiry set on the test token (e.g. 90 days)

> The secret is displayed **once** at creation. Capture it directly into its destination.

## 10. Limit each credential to Object Read & Write on its own buckets

- [ ] `sybnb-test-storage` → **Object Read & Write**, scoped to `sybnb-test-media` + `sybnb-test-documents` only
- [ ] `sybnb-staging-storage` → **Object Read & Write**, scoped to `sybnb-staging-*` only
- [ ] `sybnb-production-storage` → **Object Read & Write**, scoped to `sybnb-production-*` only
- [ ] No token is scoped account-wide

## 11. Confirm no administrative tokens are used by the application

- [ ] No token has **Admin Read & Write** or **Admin Read only**
- [ ] Understood: the application only needs to put, get and delete objects. It never needs to create buckets or change bucket settings — and a token that *could* enable public access is a single-bug path to exposing every identity document

## 12. Record credential owner and creation date — outside source control

For each token, record **outside the repository** (password manager or equivalent):

- [ ] Token name and purpose
- [ ] Creation date and expiry
- [ ] Created by (named individual)
- [ ] Rotation authority: **platform owner or the designated technical administrator only**
- [ ] **Secret values recorded only in the password manager / environment store — never in a document, ticket, or commit**

## 13. Inject TEST values securely

**Test only in this run.**

- [ ] Values placed in the local shell environment or a **gitignored** local env file
- [ ] Variables set: `STORAGE_DRIVER=s3`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_REGION=auto`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_BUCKET_MEDIA=sybnb-test-media`, `STORAGE_BUCKET_DOCUMENTS=sybnb-test-documents`
- [ ] Endpoint uses the **EU** form: `https://<R2_ACCOUNT_ID>.eu.r2.cloudflarestorage.com`
- [ ] **No `VITE_`-prefixed storage variable exists anywhere**
- [ ] Nothing hardcoded — account ID, endpoint, bucket names and credentials are all environment values

## 14. Confirm no secrets are printed or committed

- [ ] `git status` shows no env file staged or untracked-and-about-to-be-committed
- [ ] No secret pasted into chat, a ticket, a screenshot, or any document
- [ ] Terminal scrollback containing the secret cleared, if the secret was displayed
- [ ] Shell history checked if the secret was typed on a command line

## 15. Verify bucket jurisdiction and endpoint after creation

- [ ] Each of the six buckets shows the **European Union** jurisdiction in the dashboard
- [ ] The jurisdiction-scoped endpoint host resolves for the account
- [ ] Any bucket created **without** the EU jurisdiction is **deleted and recreated** — jurisdiction cannot be changed in place

## 16. Record the real bucket names

- [ ] Actual created names recorded and confirmed identical to the approved six
- [ ] Any deviation reported to the owner **before** implementation begins

## 17. Minimal connectivity check — DEFERRED until the implementation gate reopens

**[OWNER DECISION 2026-07-22]** No upload and no connection attempt occurs during this provisioning and
documentation step. This check runs **only after the implementation gate is explicitly reopened.**

When it does run:

- [ ] Small **synthetic** file (a few-byte text or 1×1 PNG) written to `sybnb-test-media`
- [ ] Same object read back successfully
- [ ] Same object deleted
- [ ] Repeat against `sybnb-test-documents`
- [ ] **No real passports, government IDs, host or guest documents, or production property records at any point**
- [ ] No output containing a credential printed or captured

*A reachability check only — not the mandatory cross-instance durability verification, which runs during
implementation per ADR-0010 §19.*

---

## Post-provisioning verification — read-only, redacted (performed by Claude)

Once the two test buckets exist and the credential is injected, Claude verifies **only** the following,
**without connecting to R2 and without printing any secret**:

| # | Check | Method |
|---|---|---|
| 1 | Storage driver configured for R2/S3-compatible test mode | Variable presence and value `s3` |
| 2 | Endpoint uses the **EU jurisdiction form** | Pattern match on `.eu.r2.cloudflarestorage.com`; **account portion redacted in any output** |
| 3 | Test media bucket name matches `sybnb-test-media` | Exact string comparison |
| 4 | Test documents bucket name matches `sybnb-test-documents` | Exact string comparison |
| 5 | Credentials present but **redacted** | Presence and non-empty length only — **never the value** |
| 6 | No staging or production credentials present | Absence check |
| 7 | Public access not intentionally configured | No public-URL variable present |
| 8 | **No `VITE_` storage variables exist** | Prefix scan |
| 9 | No repository-tracked environment file contains credentials | `git ls-files` + gitignore check |
| 10 | Connectivity check | **Deferred** — see §17 |

**Claude will never print:** access key · secret key · a complete endpoint including account context where
unnecessary · environment-file contents. **Redacted confirmation only** (e.g. "present, 32 chars").

**Credentials must never be requested in, or pasted into, chat.**

## 18. Stop before staging or production credential injection

- [ ] Staging credentials **not** injected anywhere
- [ ] Production credentials **not** injected anywhere
- [ ] Understood: those gates open separately, by explicit owner decision

---

## Completion report to provide

When the checklist is complete, confirm:

1. All six buckets created, in the **EU jurisdiction**, with the approved names — or the conflict that stopped the run
2. Public access disabled and no custom domain on all six
3. No CORS policy on any bucket
4. Lifecycle limited to incomplete-multipart cleanup
5. Three scoped Object Read & Write tokens created
6. Test credentials injected securely; staging and production **not** injected
7. Connectivity check passed using synthetic data only
8. No secret entered into chat or committed

## Reopening the implementation gate

Storage implementation is authorized only after the owner confirms all five:

1. Test buckets exist **in the EU jurisdiction**
2. Test credentials are securely injected
3. Actual bucket names and endpoint are confirmed
4. No secret was entered into chat or committed
5. **The implementation gate is explicitly reopened**

Until then: no dependency installed, no adapter implemented, no upload module modified, no environment
file changed in the repository, no Vercel region changed, no push, no merge, no deploy.
