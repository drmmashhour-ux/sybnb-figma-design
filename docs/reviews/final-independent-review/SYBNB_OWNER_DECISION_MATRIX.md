# SYBNB — Owner Decision Matrix

**Baseline:** `8a4eba7` · **Source:** `SYBNB_CONSOLIDATED_FINAL_REVIEW.md`
**Scope:** every Critical and High consolidated finding — 12 Critical, 17 High.

> **No decision has been made on the owner's behalf.** The final two columns are intentionally blank.
> "Suggested disposition" is a recommendation only and carries no authority.

---

## Critical

### SYB-001 — No date selection on the listing page
**Severity:** Critical · **Agents:** A1-01, A2-C04 (verified)
**Recommended decision:** Fix before closed beta.
**Options:** (a) render an availability-aware picker enforcing `disabledDates`; (b) ship read-only fixed-date listings; (c) defer.
**Accept:** guests choose real dates; late-failure booking rejections stop. **Reject:** guests are shown a real price for dates they never chose. **Defer:** closed beta cannot open — this is the core journey.
**Suggested disposition:** Approve (a).
**Final owner decision:** ______ **Owner notes:** ______

### SYB-002 — `PAYMENT_PENDING` bookings hold inventory permanently
**Severity:** Critical · **Agents:** A1-02, A2-C02 (verified)
**Recommended decision:** Fix before closed beta. **Requires a business rule from you: the expiry window.**
**Options:** (a) expiry + guest cancel + host visibility + admin release; (b) admin release only; (c) make pending bookings non-blocking for availability.
**Accept:** abandoned checkouts release inventory. **Reject:** any abandoned checkout removes a listing's dates permanently, with nobody able to see or undo it. **Defer:** inventory degrades monotonically from first use.
**Suggested disposition:** Approve (a); set the window at 30–60 minutes.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-003 — No notification mechanism of any kind
**Severity:** Critical · **Agents:** A1-03
**Recommended decision:** Define minimum scope before closed beta.
**Options:** (a) transactional email for booking + payment state changes only; (b) full notification centre; (c) operate the beta manually via WhatsApp.
**Accept:** participants learn when their booking or payment changes state. **Reject:** a manual payment-review model with no way to tell anyone anything happened. **Defer:** feasible at 20–30 guests with (c), but only with named staff and stated hours.
**Suggested disposition:** Approve (a) — narrow, uses the already-configured Resend mailer.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-004 — STG-12 recorded CLOSED; forced download on 2 of 9 routes
**Severity:** Critical · **Agents:** A3-02 (verified)
**Recommended decision:** Fix, and correct the committed documents.
**Options:** (a) apply to all private-document routes + correct docs; (b) correct docs only and re-scope the finding; (c) accept.
**Accept:** the control matches its documented claim. **Reject:** a committed security document overstates a control — the most damaging kind of inaccuracy. **Defer:** every future reader inherits the error.
**Suggested disposition:** Approve (a). Note this corrects my own prior work.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-005 — STG-24 recorded CLOSED; staff audit on 1 of 9 routes
**Severity:** Critical · **Agents:** A3-03 (verified)
**Recommended decision:** Fix, and correct the committed documents.
**Options:** (a) apply to all staff document reads + correct docs; (b) correct docs only; (c) accept.
**Accept:** staff access to driver, Québec, listing and thread documents becomes traceable. **Reject:** those reads leave no trace while documentation says they are audited. **Defer:** as SYB-004.
**Suggested disposition:** Approve (a).
**Final owner decision:** ______ **Owner notes:** ______

### SYB-006 — Fabricated data reaches real users
**Severity:** Critical · **Agents:** A2-C05/C06/C07, A3-12, A1
**Recommended decision:** Remove before closed beta.
**Options:** (a) delete browser-side payment fabrication and fallback inventory, gate the seed; (b) gate to development builds; (c) accept.
**Accept:** users only ever see real state. **Reject:** a browser can mint an `APPROVED` payment and a receipt with no server involvement — the most serious truthfulness defect in the review. **Defer:** incompatible with the platform's own truthfulness rule.
**Suggested disposition:** Approve (a). A development-only gate leaves a payment-fabrication path one flag from production.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-007 — `/api/auth/checkout-guest` unauthenticated and unthrottled
**Severity:** Critical · **Agents:** A2-C01 (verified)
**Recommended decision:** Fix before any public exposure.
**Options:** (a) add a rate-limit rule; (b) rule + reconsider anonymous account minting; (c) accept.
**Accept:** the account factory is bounded. **Reject:** unlimited real accounts and session tokens at negligible cost — and the feedstock for SYB-002. **Defer:** unsafe the moment the app is reachable.
**Suggested disposition:** Approve (a) now, (b) before public launch. One rule closes the immediate hole.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-008 — All 8 divisions ship active
**Severity:** Critical · **Agents:** A1-05, A2-H08
**Recommended decision:** Execute the already-approved isolation plan.
**Options:** (a) execute as approved; (b) hide navigation only; (c) accept.
**Accept:** the product presents the one division it can operate. **Reject:** the platform advertises eight businesses it cannot run. **Defer:** every beta participant sees seven non-functional divisions.
**Suggested disposition:** Approve (a). Already approved; only execution is outstanding.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-009 — `SUPPORT` exempt from staff sign-in step-up
**Severity:** Critical · **Agents:** A3-01 (verified)
**Recommended decision:** Fix immediately.
**Options:** (a) add `SUPPORT` to `STAFF_ROLES_REQUIRING_OTP`; (b) reduce SUPPORT authority instead; (c) accept.
**Accept:** the role with the broadest identity-document authority gains the same step-up as every other staff role. **Reject:** a password-only account can read any user's identity document and upload one onto any account. **Defer:** unacceptable at any exposure level.
**Suggested disposition:** Approve (a) — a one-token change, and the cheapest Critical in this review.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-010 — Guest has no account surface
**Severity:** Critical · **Agents:** A1-04
**Recommended decision:** Define scope before closed beta.
**Options:** (a) wire the orphaned pages and add a trips list; (b) remove the dead routes and rely on the booking-lookup link; (c) defer.
**Accept:** guests can find their bookings. **Reject:** `/account` and `/dashboard` silently render the landing page — a dead end presented as a destination. **Defer:** (b) is a legitimate minimal answer for a beta.
**Suggested disposition:** Approve (b) for the beta, (a) before public launch.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-011 — No payout write path and no withdrawal rail
**Severity:** Critical · **Agents:** A1-07, A2-H01
**Recommended decision:** Resolve before accepting real bookings. **Requires a payout-rail decision from you.**
**Options:** (a) payout-method capture + withdrawal path; (b) manual off-platform payout with a documented process; (c) defer.
**Accept:** hosts can be paid. **Reject:** the platform takes a 13% commission with no mechanism for money to leave. **Defer:** only tenable with (b) and explicit disclosure to beta hosts.
**Suggested disposition:** Approve (b) for the beta with written disclosure; (a) before public launch.
**Final owner decision:** ______ **Owner notes:** ______

### SYB-018 — Production template omits every required storage and Redis variable
**Severity:** Critical · **Agents:** A2-C03 (verified)
**Recommended decision:** Fix now — documentation only.
**Options:** (a) add the 7 `STORAGE_*` and 2 `UPSTASH_*` variables to the template; (b) accept.
**Accept:** a deployment built from the documented template can boot. **Reject:** it cannot — `validateProductionConfig()` refuses. **Defer:** blocks internal testing, not just production.
**Suggested disposition:** Approve (a). Zero-risk, documentation-only, unblocks a gate.
**Final owner decision:** ______ **Owner notes:** ______

---

## High

| ID | Finding | Agents | Recommended | Options | Accept | Reject | Defer | Suggested | Decision | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| **SYB-012** | Ride/Québec storage still ephemeral | A2-H06, A3-07 | Migrate on unfreeze | (a) migrate now (b) accept while frozen (c) block routes | Defect removed | Silent loss of driver licences if SR ships | Safe only while frozen | (b) + a hard gate on unfreezing | ___ | ___ |
| **SYB-013** | No observability (STG-22) | A2-H05, A3-13 | Before public launch | (a) full (b) error aggregation only (c) defer | Failures become visible | Nobody learns of any failure | Tolerable at beta scale with manual watch | (b) before beta | ___ | ___ |
| **SYB-014** | S3 driver never executed | A2-H02 | Execute Validation Wave 1 | (a) execute (b) defer | Central storage claim proven | The fix is unverified against R2 | Blocks closed beta | (a) — plan already approved | ___ | ___ |
| **SYB-015** | No storage backfill | A2-H03 | Audit first | (a) audit + backfill (b) confirm none exist | Pre-migration objects reachable | Silent 404s on old records | Low risk if none exist | (b) audit, then decide | ___ | ___ |
| **SYB-016** | Published privacy/security claims contradicted | A1-09, A3-06, A3-11 | Fix before beta | (a) correct claims (b) correct code (c) both | Claims become true | Platform publishes false statements about its own handling | Not tenable | (c) | ___ | ___ |
| **SYB-017** | Demo seed creates verified accounts + live listing | A2-C07, A3-12 | Gate before beta | (a) refuse in production + suppress (b) delete seed | No demo data in real inventory | A fake listing is bookable by real users | Blocks beta | (a) | ___ | ___ |
| **SYB-020** | ID documents have no hold; replacement destroys evidence | A3-05 | Decide D-7 | (a) implement holds (b) decide policy only (c) defer | Evidence survives where required | Fraud and dispute evidence destroyed on replacement | **Irreversible** — deletion cannot be undone | (b) now, (a) before public | ___ | ___ |
| **SYB-021** | No scheduler; time transitions are traffic-driven | A2-M01, A3-09 | Before beta | (a) Vercel cron (b) external trigger (c) defer | Expiry and retention actually run | SYB-002 and SYB-032 cannot be fixed | Blocks SYB-002 | (a) | ___ | ___ |
| **SYB-022** | D-2 fail-closed not implemented; routes unrated | A3-04 | Implement approved decision | (a) implement (b) revise D-2 | Approved decision realised | An approved security decision is unimplemented | Recorded as done when it is not | (a) | ___ | ___ |
| **SYB-023** | Prisma generate absent from Vercel build | A2-H04 | Fix now | (a) add generate + binary target (b) accept | Deployment can build | Build or runtime failure | Blocks internal testing | (a) | ___ | ___ |
| **SYB-024** | Search recovery actions inert | A1-06 | Before beta | (a) wire retry (b) remove buttons | Users can recover | Buttons that do nothing | Erodes trust | (a) | ___ | ___ |
| **SYB-025** | No body cap; upload payloads exceed serverless limits | A2-H07, A3-10 | Before beta | (a) cap + limits (b) cap only | Bounded memory and cost | Unbounded buffering on unauthenticated routes | Blocks beta | (a) | ___ | ___ |
| **SYB-026** | No confirmation on irreversible admin actions | A1-08 | Before beta | (a) confirm dialogs (b) accept | Mis-clicks stop moving money | One mis-click moves real money | Roadmap C7 | (a) | ___ | ___ |
| **SYB-027** | FR exposed; 2 of 68 screens localized | A1-10 | Before beta | (a) hide FR (b) complete FR | Users cannot select a broken language | ~66 screens silently English under FR | Roadmap S4 | (a) | ___ | ___ |
| **SYB-028** | Guest count never sent to API | A1-12 | Before beta | (a) pass occupancy (b) remove control | Results match the query | Wrong results returned confidently | Roadmap H6 | (a) | ___ | ___ |
| **SYB-029** | Host buttons route wrongly, one into ADMIN gate | A1-11 | Before beta | (a) correct targets (b) remove | Navigation works | A host hits an admin gate | Low effort | (a) | ___ | ___ |
| **SYB-031** | Account deletion leaves email in audit payloads | A3-08 | Before public | (a) redact payloads (b) accept | Deletion means deletion | Deletion is incomplete | Privacy exposure | (a) | ___ | ___ |

---

## Cross-cutting decisions

| # | Decision | Why it is yours |
|---|---|---|
| **X-1** | Does the closed beta open before or after SYB-003 (notifications) and SYB-011 (payouts)? | Determines whether the beta is manually operated |
| **X-2** | Do committed documents get corrected in place, or by appended errata? | Governance precedent for how error is recorded |
| **X-3** | Does Validation Wave 1 execute now, given SYB-014 blocks closed beta? | Requires authorising the first Cloudflare connection |
| **X-4** | Is SYB-012 formally accepted while Ride and Québec stay frozen? | Converts a defect into a recorded accepted risk with a named trigger |
