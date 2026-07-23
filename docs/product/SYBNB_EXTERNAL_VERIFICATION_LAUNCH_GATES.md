# SYBNB — External Verification Launch Gates (Risk Register)

**Date opened:** 2026-07-22
**Classification for every item below:** **PUBLIC LAUNCH BLOCKER — EXTERNAL VERIFICATION REQUIRED**
**Status:** all items **OPEN**. None is resolved, and nothing here may be represented as resolved.

## Purpose and limits

This register tracks matters that **cannot be settled from inside the codebase**. Each requires
verification by an external party — legal counsel, or the provider under its current terms.

> **No item in this document contains a legal conclusion, and none should be read as advice.**
> Each entry states the question, why it matters to SYBNB specifically, who can answer it, and what
> evidence would close it. Nothing more.

**Scope of the block.** These items block **public launch and the closed beta with real users**. They do
**not** block local development, the storage implementation, or technical storage testing with synthetic
data — **unless a provider's own terms prohibit the test itself**, which is the specific question in
EV-01 and EV-02.

**Why these surfaced now.** The EU-jurisdiction decision (ADR-0010 §3a) was explicitly recorded as a
technical infrastructure decision and not a legal one. These are the questions it deliberately left open,
plus the provider-eligibility questions raised during the residency analysis.

---

## EV-01 — Cloudflare eligibility for the intended service and user geography

| Field | Detail |
|---|---|
| **Question** | Do Cloudflare's current terms of service, acceptable-use policy, and export-compliance/sanctions position permit SYBNB to operate a service whose users are located in Syria, and to store those users' personal data in R2? |
| **Why it matters** | R2 is the approved durable store for all uploaded files, including identity documents. If Cloudflare's terms restrict service to or from Syria, the storage architecture may not be usable as designed, and this would be discovered after implementation rather than before. |
| **Who can answer** | Cloudflare directly (sales/legal/compliance), plus SYBNB's counsel reviewing the current terms. |
| **Evidence that closes it** | Written confirmation from Cloudflare, or a counsel memo assessing the current published terms against the intended service and user geography. |
| **Blocks technical testing?** | **Potentially — this is the one item that could.** Testing uses synthetic data from a developer machine, not Syrian end users, so it is likely permissible; but if Cloudflare's terms prohibit account use in connection with the intended service at all, that would need resolving first. **Verify before staging or production provisioning.** |
| **Status** | **OPEN** |

## EV-02 — Vercel eligibility for the intended service and user geography

| Field | Detail |
|---|---|
| **Question** | Do Vercel's current terms of service and export-compliance/sanctions position permit hosting an application serving users located in Syria? |
| **Why it matters** | Vercel is the deployment target for the entire platform. A restriction here affects far more than storage — it affects whether the platform can be hosted as designed at all. |
| **Who can answer** | Vercel directly, plus SYBNB's counsel. |
| **Evidence that closes it** | Written confirmation from Vercel, or a counsel memo on the current published terms. |
| **Blocks technical testing?** | No — local development does not use Vercel. Blocks any deployed environment, including staging. |
| **Status** | **OPEN** |

## EV-03 — Sanctions and export-control constraints

| Field | Detail |
|---|---|
| **Question** | Which sanctions and export-control regimes apply to a Canadian-owned entity operating a marketplace serving users in Syria, and what obligations or restrictions follow — including payment processing, identity verification, and data handling? |
| **Why it matters** | The platform holds identity documents, moves money (13% commission, wallet, manual payment review), and will onboard Syrian hosts and guests. Sanctions exposure is not limited to storage. |
| **Who can answer** | Counsel with sanctions/export-control expertise in the relevant jurisdictions. |
| **Evidence that closes it** | A counsel opinion covering the platform's actual activities, not storage alone. |
| **Blocks technical testing?** | No. Blocks onboarding real users and processing real money. |
| **Status** | **OPEN** |

## EV-04 — Applicable privacy regime for Syrian residents

| Field | Detail |
|---|---|
| **Question** | Which data-protection regime governs personal data of Syrian residents processed by a Canadian-owned entity and stored in the EU? What lawful basis, notice, retention and data-subject rights follow? |
| **Why it matters** | The platform collects government identity documents — the highest-sensitivity category it handles. The Terms and Privacy pages describe actual behaviour accurately, but were not written against a determined regime. |
| **Who can answer** | Privacy counsel. |
| **Evidence that closes it** | A counsel determination of the applicable regime(s) and any required changes to the privacy notice, retention policy, and data-subject-request handling. |
| **Blocks technical testing?** | No — testing uses synthetic data only. Blocks collecting real identity documents from real users. |
| **Status** | **OPEN** |

## EV-05 — Canadian corporate privacy obligations

| Field | Detail |
|---|---|
| **Question** | What Canadian privacy obligations (federal or provincial) attach to a Canadian entity processing personal data of non-Canadian users stored outside Canada? |
| **Why it matters** | R2 offers no Canadian residency option, so data will be stored outside Canada by design. If Canadian obligations require disclosure of cross-border storage, the privacy notice must say so. |
| **Related open item** | Roadmap **B1** — the legal pages carry no registered company name or address. A privacy position is of limited value while the operating entity is unidentified. **These should be resolved together.** |
| **Who can answer** | Canadian privacy counsel. |
| **Evidence that closes it** | A counsel memo, plus any resulting changes to the legal pages. |
| **Blocks technical testing?** | No. |
| **Status** | **OPEN** |

## EV-06 — Additional obligations arising from EU storage

| Field | Detail |
|---|---|
| **Question** | Does storing personal data in the EU jurisdiction create contractual or regulatory obligations SYBNB does not currently meet — for example a data processing agreement with Cloudflare, GDPR-style records of processing, a representative requirement, or breach-notification duties? |
| **Why it matters** | The EU jurisdiction was chosen for the strength of its residency guarantee. That choice may carry obligations that a location hint would not have. This was flagged as a known trade-off at the time of the decision, not discovered afterwards. |
| **Who can answer** | Privacy counsel, plus review of Cloudflare's data-processing terms. |
| **Evidence that closes it** | A counsel assessment and any executed data-processing agreement. |
| **Blocks technical testing?** | No. |
| **Status** | **OPEN** |

## EV-07 — Cross-border access by administrators and support personnel

| Field | Detail |
|---|---|
| **Question** | If data is stored in the EU but administrators or support staff access it from Canada or elsewhere, does that access constitute a regulated transfer, and what controls or disclosures are required? |
| **Why it matters** | The admin console grants staff the ability to open identity documents (`/api/admin/id-document/:userId/file`). Residency of storage does not constrain residency of *access*, and the access path is real and already implemented. |
| **Who can answer** | Privacy counsel. |
| **Evidence that closes it** | A counsel determination, plus any required access controls, logging, or notice changes. |
| **Blocks technical testing?** | No. |
| **Status** | **OPEN** |

---

## Summary

| ID | Item | Blocks technical testing? | Status |
|---|---|---|---|
| EV-01 | Cloudflare eligibility | **Possibly — verify first** | OPEN |
| EV-02 | Vercel eligibility | No (blocks deployment) | OPEN |
| EV-03 | Sanctions / export control | No | OPEN |
| EV-04 | Privacy regime for Syrian residents | No | OPEN |
| EV-05 | Canadian corporate privacy obligations | No | OPEN |
| EV-06 | EU-storage obligations | No | OPEN |
| EV-07 | Cross-border administrator access | No | OPEN |

**Nothing in this register is resolved.** Each item closes only on external evidence recorded against it.

**Related technical gates** (tracked separately, not in this register): persistent object storage,
division isolation, fabricated-data removal, C4 availability enforcement, H3 host payout, and the
application runtime region.
