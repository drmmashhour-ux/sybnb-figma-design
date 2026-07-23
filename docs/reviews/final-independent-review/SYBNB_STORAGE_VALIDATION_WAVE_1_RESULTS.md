# SYBNB — Storage Validation Wave 1 Results

**Baseline:** commit `9e768f8` (Wave 0 complete) · **Date:** 2026-07-23 · **Harness:**
`scripts/storage-validation-wave-1.mjs` · **Verdict: VALIDATION WAVE 1 PASSED (20/20).**

> This is the X-3 / SYB-014 mandatory closed-beta storage-durability gate. It exercises the real
> governed object-storage layer (`server/lib/object-storage.mjs`) against live Cloudflare R2 **test
> buckets** with **synthetic data only**. No production bucket, object, credential, or customer data
> was touched.

---

## 1. Test environment

| Item | Value |
|---|---|
| Storage driver | `s3` (Cloudflare R2, S3-compatible) |
| Addressing | path-style (`forcePathStyle: true`) |
| Account ID | `c492d6ff9c6df8b803152dca8f9b8d2e` |
| Endpoint used | `https://c492d6ff9c6df8b803152dca8f9b8d2e.r2.cloudflarestorage.com` (default endpoint) |
| Bucket location | **Eastern Europe (EEUR)** location hint, **default jurisdiction** |
| Test buckets | `sybnb-test-media`, `sybnb-test-documents` |
| Node | v20.20.2 · `@aws-sdk/client-s3` |
| Credentials | R2 API token (access-key fingerprint `bd367e4a137d`), Object Read & Write on both test buckets |

### ⚠ Jurisdiction deviation from ADR-0010 (owner-accepted)

ADR-0010 mandates the **EU jurisdiction** endpoint (`…eu.r2.cloudflarestorage.com`). The test buckets
were created in R2's **default jurisdiction** with an **Eastern Europe (EEUR) location hint**, which is a
*data-placement hint*, **not** the formal EU-jurisdiction data-residency boundary, and is reachable only
at the **default** endpoint. On the owner's explicit instruction to make the gate pass without recreating
the buckets, `STORAGE_S3_ENDPOINT` in the local test config (`.env.local`, gitignored — not committed,
not a production file) was pointed at the default endpoint to match the buckets. **This validation
therefore exercised the default/EEUR endpoint, not the EU-jurisdiction endpoint.**

**Consequence and standing risk:** the durability/access-control behaviour is proven, but for a
**different jurisdiction than production's EU target**. Production config (`.env.production.example`,
ADR-0010) still mandates the EU-jurisdiction endpoint. Before public launch, either the production
buckets must be created in the **EU jurisdiction** and re-validated there, or ADR-0010's jurisdiction
wording must be formally revised. This is recorded as a remaining risk (§6), not resolved here.

## 2. Synthetic-data declaration

Every object written was a synthetic PDF (`%PDF-1.7` header + filler bytes), generated in-harness. No
real media, identity document, customer record, or production data was used, read, or written. Object
keys are random UUIDs (`buildObjectKey`). All objects were deleted at the end of the run.

## 3. Scenarios executed — pass/fail matrix (20/20)

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | upload | object written, no error | **PASS** |
| 2 | download | bytes returned | **PASS** |
| 3 | overwrite | new bytes replace old | **PASS** |
| 4 | metadata | `ContentType application/pdf` + `ContentLength` round-trip | **PASS** |
| 5 | delete | object removed (`exists=false`) | **PASS** |
| 6 | object integrity | `sha256(get) == sha256(put)` | **PASS** |
| 7 | invalid credentials | sanitized `STORAGE_UNAVAILABLE`, no secret leaked | **PASS** |
| 8 | invalid endpoint | sanitized `STORAGE_UNAVAILABLE`, no endpoint leaked | **PASS** |
| 9 | unavailable storage | `STORAGE_UNAVAILABLE`, no false success | **PASS** |
| 10 | interrupted upload | no partial object persisted | **PASS** |
| 11 | interrupted download | `STORAGE_OBJECT_NOT_FOUND`, no garbage | **PASS** |
| 12 | retry behaviour | SDK retries; op completes intact | **PASS** |
| 13 | recovery | valid op succeeds after a prior failure | **PASS** |
| 14 | access control | unauthenticated direct GET refused (not 200) | **PASS** |
| 15 | bucket isolation | object in DOCUMENTS absent from MEDIA | **PASS** |
| 16 | object naming | 4 malformed keys refused; valid UUID accepted | **PASS** |
| 17 | cleanup | all created objects removed (verified `remaining=0`) | **PASS** |
| 18 | durability assumptions | **fresh process reads identical bytes** (survives instance replacement) | **PASS** |
| 19 | large object handling | 5 MB round-trips with integrity | **PASS** |
| 20 | failure reporting | no endpoint/credential/secret in any failure message | **PASS** |

**Scenario 18 is the central gate:** an object written by one process was read back, byte-identical
(SHA-256 match), by a **separately spawned Node process** with its own S3 client — direct proof that
uploads survive instance replacement, which the ephemeral local-disk driver could never guarantee. This
resolves the core SYB-014 concern (for the validated endpoint).

**Scenario 14 (access control):** an unauthenticated direct HTTPS GET to the bucket object URL was
refused — the buckets are private (the dashboard also confirms Public Development URL disabled). This is
the direct proof that objects are not publicly served.

## 4. Harness note — one defect found and fixed during the run

The first run reported **19/20** — only scenario 17 (cleanup) failed with `deleted=0, remaining=5`. Root
cause was a **defect in the harness cleanup loop**, not the storage layer: the loop called
`deleteObject(c)` omitting the `env` argument that every other call passes, so it fell back to
`process.env` (no `STORAGE_DRIVER`) and threw, deleting nothing (the storage layer's delete works — the
`delete` scenario #5 passed). The `env` argument was added (`deleteObject({ ...c, env })`), the 5 orphaned
objects from that run were deleted, and the harness re-run passed **20/20** cleanly. This is the only
change made to the harness, and it is a proven defect fix, not a weakening of any check.

## 5. Cleanup confirmation

After the passing run, both test buckets were listed independently: **`sybnb-test-media` = 0 objects,
`sybnb-test-documents` = 0 objects.** No synthetic object remains in either bucket. The 5 orphans from
the first (defective-cleanup) run were also deleted. Buckets are empty.

## 6. Remaining risks

1. **Jurisdiction (highest):** validated against the **default/EEUR** endpoint, not the ADR-0010 **EU
   jurisdiction** endpoint (§1). Production must be validated against EU-jurisdiction buckets, or the ADR
   revised, before public launch. SYB-014 is proven for the *tested* endpoint only.
2. **STG-11 (unchanged):** signature validation ≠ malware scanning ≠ deep structural validation. Not in
   scope for Wave 1.
3. **STG-14 orphan reconciliation (unchanged):** the process-crash window between object write and
   metadata commit can still orphan objects; no reconciliation job exists. Wave 1 did not build one.
4. **Frozen modules (X-4):** `driver-document-storage.mjs` / `quebec-document-storage.mjs` remain on
   ephemeral local disk; not exercised here and gated behind the freeze.
5. **Credential hygiene:** the R2 test token secret was pasted into the chat during setup and **should be
   rotated** now that validation is complete.

## 7. Verdict

# VALIDATION WAVE 1 PASSED

20 of 20 required scenarios passed, including cross-instance durability (18) and private-bucket access
control (14). Cleanup verified — both test buckets empty. The one interim failure was a harness cleanup
defect (fixed), never a storage-layer failure. **Standing caveat:** validated against the default/EEUR
endpoint per owner instruction, not the EU-jurisdiction endpoint ADR-0010 mandates — see §1 and §6.1.
