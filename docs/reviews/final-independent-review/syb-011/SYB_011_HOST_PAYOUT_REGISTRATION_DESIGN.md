# SYB-011 — Host Payout Registration & Manual Beta Disclosure Design

**Baseline:** commit `32b2152` · **Date:** 2026-07-23 · **Status:** design for owner approval.
**No code, schema, API, UI, or payout rail. Nothing implemented.**

> Authorized under Owner Decision Session 01 (SYB-011 ACCEPTED — Manual Beta Payout Strategy). This
> document designs (1) the written host disclosure the owner mandated before onboarding, and (2) a
> governed workflow for a host to register a payout destination. **Planning only — implementation is not
> authorized.** The production payout rail (provider, KYC, AML, reconciliation, tax) is a separate,
> deferred owner decision and is out of scope here.

---

## 1. What already exists (verified at `32b2152`)

| Fact | Location |
|---|---|
| `User.payoutMethod` is **`Json?`**, documented shape `{ type: 'sham_cash', phone, receiverName }` | `prisma/schema.prisma` (User) |
| It is **surfaced only to admin payout reminders**, never to guests or other hosts | schema comment · `admin.mjs:135,165` |
| It has **no write path for a host** — read-only in practice | verified (SYB-011 finding) |
| Admin "release" credits the internal wallet; **no host withdrawal endpoint** | `host.mjs:361`, `admin.mjs:180` |
| STR commission is **13%** (`STR_ADMIN_COMMISSION_RATE = 0.13`) | `finance-ledger.mjs:16` |

**Design consequence:** the field and its shape already exist. Registration is a **governed write path**
to an existing column — not a new data model. No schema change is anticipated (the `Json?` column already
holds the intended shape).

**Ride boundary:** `driverProfile.payoutMethod` / `payoutAccountRef` and the frozen Sham Cash driver
payout (`admin.mjs:1308–1341`) are **not reused**. Ride stays independently frozen. This design touches
only the STR host path.

---

## 2. Manual-payout written disclosure (owner-mandated, pre-onboarding)

Every host must receive and acknowledge this **before onboarding**. Content required by the owner:

| Disclosure element | What it states |
|---|---|
| **Payouts are manual** | During the closed beta, host payouts are performed **by hand by SYBNB staff**, not by an automated rail. |
| **Expected timing** | The target turnaround (a concrete SLA the owner sets, e.g. "within N business days of a released booking"). No instant payout. |
| **Approved payout methods** | The methods a host may register (see §3.2) — Sham Cash as primary; any others the owner approves. |
| **Review requirements** | Payouts are reviewed before disbursement; the host may be asked to confirm destination details. |
| **Support process** | How a host raises a payout question or dispute, and the expected response path. |

**Delivery & record:** the disclosure is shown at onboarding, the host explicitly acknowledges it, and
the acknowledgement is recorded (actor, timestamp, disclosure version) so "the host was told in advance"
is provable. This is an **auditable consent record**, not a checkbox that leaves no trace.

**Truthfulness rule:** the product must not display "instant payout," "automatic," or any timing the
manual process cannot meet. This is the same truthfulness principle behind SYB-006 — no interface claim
the platform cannot honour.

---

## 3. Governed payout-registration workflow (design)

### 3.1 Goal

Let a host register **where** their payouts should go, into `User.payoutMethod`, through a governed,
authenticated, audited path — without building any money-movement rail. Registration ≠ payout.

### 3.2 Payout-method shape (reuse the documented JSON)

```jsonc
// User.payoutMethod — illustrative, for approval; matches the existing documented shape
{
  "type": "sham_cash",           // owner-approved method enum: e.g. sham_cash | bank_transfer
  "receiverName": "<string>",     // name on the receiving account
  "phone": "<string>",            // for sham_cash
  "accountRef": "<string>",       // for bank_transfer (IBAN/account) — method-dependent
  "registeredAt": "<ISO8601>",
  "version": 1
}
```

The **set of approved methods is an owner decision** (§ open decisions). Sham Cash is the documented
primary. Only server-side-validated shapes are stored; the client never dictates which fields are
authoritative.

### 3.3 The write path (specification, not implemented)

- **Endpoint:** an authenticated `PATCH /api/me/payout-method` (host-scoped, caller can only write their
  own). Mirrors the existing `/api/me/*` self-service pattern.
- **Validation:** server validates `type` against the approved-method allowlist and the required fields
  for that type; rejects unknown types and unknown fields (same posture as the document routes).
- **No sensitive-credential storage.** A payout *destination* (phone, receiver name, account reference)
  is not a password or card number. **Full bank credentials, card numbers, or government IDs must not be
  entered here** — if a method ever needs those, it belongs behind the deferred production KYC rail, not
  this beta form.
- **Audit:** each registration/change writes an audit record (actor, timestamp, prior/new method *type*
  — never the raw account detail in the log) reusing the `AdminAuditLog` pattern.
- **Visibility:** the host sees their own registered method (masked where sensitive); it remains surfaced
  to admin payout reminders as today. Never exposed to guests or other hosts.

### 3.4 How registration feeds the manual payout

1. Host registers a payout method (this workflow).
2. Booking confirmed → 13% commission split → host share accrues → admin "releases" it to the host wallet
   (existing `/api/admin/payouts/:id/release`).
3. Staff read the registered `payoutMethod` from the admin payout reminder and **disburse by hand**
   off-platform, per the disclosed SLA.
4. Staff record the manual disbursement (see the account-closure/payout-state design for the state model
   that should back this — `SYB_011_ACCOUNT_CLOSURE_PAYOUT_STATE_DESIGN.md`).

Steps 1 and the audit in 3–4 are the governed parts; the actual money movement is manual and disclosed.

### 3.5 Accessibility & mobile

- The registration form is keyboard-operable, labelled, and error-messaged accessibly; method-specific
  fields are announced when the type changes.
- Mobile-friendly single-column layout; no horizontal scroll; touch-sized inputs.
- AR/EN correct, RTL/LTR.

---

## 4. What this design deliberately does NOT do

- No automated payout rail, no provider integration, no KYC/AML — all deferred to the separate public-
  launch decision.
- No reuse of the frozen Ride payout implementation.
- No change to the commission split or the admin release mechanism.
- No implementation of the endpoint — this is a specification for a later, separately authorized build.
- No modification of account-closure behaviour (covered, design-only, in the sibling document).

## 5. Open owner decisions before any implementation

- **Approved payout-method set** — Sham Cash only, or also bank transfer / others?
- **Payout SLA** — the concrete timing figure to disclose.
- **Disclosure copy** — final wording and version scheme (AR/EN).
- **Whether registration ships in the beta at all**, or payout destinations are collected manually by
  staff during onboarding until the write path is built.
- **Masking policy** — how much of a registered destination the host sees back.
