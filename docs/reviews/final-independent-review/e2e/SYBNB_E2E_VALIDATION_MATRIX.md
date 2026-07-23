# SYBNB — End-to-End Validation Matrix

**Baseline:** `6e8b8f2` · **Date:** 2026-07-23 · **Environment:** local only (API `127.0.0.1:3051`, web `127.0.0.1:5180`, local Postgres)
**Storage driver:** `local` filesystem, temp dir outside the repository. **R2 not connected.**
**Not exercised by instruction:** Stripe/card paths (live test key present) · `POST /api/host/insights/generate` (paid AI).
**Email/SMS:** not configured — no message left the machine; OTPs returned inline as `devCode`.

**Testability status legend:** ✅ testable and tested · ⚠️ testable only via disclosed workaround · ⛔ blocked by environment · ✖ not implemented · 🚫 not safe to test.

---

## 1. Client / guest sections

| Section | Starting role | Required action | Expected system result | Next responsible role | Final authoritative state | Audit evidence | Testability |
|---|---|---|---|---|---|---|---|
| Public landing | Guest | Load `/` | Division grid renders | — | none | none | ✅ |
| Listing search | Guest | Search STAYS | Approved listings returned | — | none | none | ✅ |
| Filters | Guest | Apply filters | Filtered result set | — | none | none | ✅ |
| Listing detail | Guest | Open listing | Detail + gallery + amenities | — | none | none | ✅ |
| Availability | Guest | View dates | Blocked dates enforced | — | `ListingAvailability` | none | ✖ no picker rendered |
| Booking creation | Guest | Create booking | `PAYMENT_PENDING` booking | Host | `Booking` | **none** | ✅ |
| Payment — local wallet | Guest | Submit proof | `PaymentProof` `PENDING_ADMIN_REVIEW` | Admin | `PaymentProof` | **none** | ✖ no-op |
| Payment — card | Guest | Pay by card | Stripe session | Admin | `PaymentProof` | none | 🚫 external provider |
| Booking confirmation | Guest | View booking | Confirmed state | — | `Booking.status` | none | ⛔ unreachable |
| Cancellation | Guest | Cancel | Booking cancelled, dates released | Host/Admin | `Booking` | none | ✖ rejected in `PAYMENT_PENDING` |
| Refund status | Guest | View refund | Refund state visible | Admin | `WalletEntry` | none | ⛔ unreachable |
| Trips | Guest | View trips | Trip list | — | `Booking` | none | ✖ not implemented |
| Favourites | Guest | Save listing | Saved item | — | — | — | ✖ not implemented |
| Messages | Guest | Message host | Thread message | Host | `Message` | none | ⚠️ post-confirmation only |
| Profile | Guest | Edit profile | Updated user | — | `User` | none | ✖ not implemented |
| Identity submission | Guest | Upload ID | `PENDING_REVIEW` | Admin | `User.idDocumentRef` | none on submit | ✅ |
| Support request | Guest | Contact support | Support record | Support | — | — | ✖ not implemented |
| Sign in / up / out | Guest | Authenticate | Session | — | `User` | none | ✖ no client UI |

## 2. Host sections

| Section | Starting role | Required action | Expected result | Next role | Final state | Audit evidence | Testability |
|---|---|---|---|---|---|---|---|
| Host onboarding | Host | Register + OTP | HOST account | — | `User`+`UserRole` | none | ✅ |
| Host verification | Host | Upload ID | `PENDING_REVIEW` | Admin | `User.idDocumentStatus` | none on submit | ✅ |
| Listing creation | Host | Create listing | `DRAFT` listing | Admin | `Listing` | **none** | ✅ |
| Listing editing | Host | Edit listing | Updated listing | — | `Listing` | none | ✖ not implemented (UI shows control) |
| Media upload | Host | Upload photo | `ListingMedia` + object | — | `ListingMedia` | none | ✅ |
| Document upload | Host | Upload CITQ | `ListingDocument` | Admin | `ListingDocument` | none | ✅ |
| Availability calendar | Host | Block dates | `ListingAvailability` | Guest | `ListingAvailability` | none | ✅ |
| Pricing | Host | Set price | Updated price | Guest | `Listing.priceMinor` | none | ⚠️ round-up defect |
| Submit for review | Host | Submit | `PENDING_REVIEW` | Admin | `Listing.status` | none | ✅ |
| **Listing publication** | Admin | Approve | `APPROVED`, publicly visible | Guest | `Listing.status` | audit row | **⛔ fails closed — jurisdiction** |
| Reservations | Host | View reservations | Reservation list | — | `Booking` | none | ⚠️ `PAYMENT_PENDING` hidden |
| Booking response | Host | Confirm/cancel | State change | Guest | `Booking.status` | none | ⚠️ not from `PAYMENT_PENDING` |
| Guest communication | Host | Message guest | Thread message | Guest | `Message` | none | ⚠️ post-confirmation only |
| Earnings | Host | View earnings | Earnings summary | — | `WalletEntry` | none | ⚠️ mislabelled |
| Payout configuration | Host | Set payout method | `User.payoutMethod` | Admin | `User` | none | ✖ no write path |
| Withdrawal | Host | Withdraw funds | Money leaves platform | — | — | — | ✖ not implemented |
| Tax statement | Host | View statement | Accurate income | — | `PartXXRecord` | none | ⚠️ overstates income |
| Analytics | Host | View views | Real metrics | — | — | — | ✖ fabricated by formula |
| Reviews | Host | View/respond | Review + response | Guest | `ListingReview` | none | ⚠️ partial |
| Promotions | Host | Create offer | Offer applied | Guest | `Listing.metadata` | none | ⚠️ erased by round-up |

## 3. Admin sections

| Section | Starting role | Required action | Expected result | Next role | Final state | Audit evidence | Testability |
|---|---|---|---|---|---|---|---|
| Admin sign-in + step-up | Admin | Login | `403 STAFF_OTP_REQUIRED` then OTP | — | session | none | ✅ correct |
| **SUPPORT sign-in** | Support | Login | Step-up required | — | session | none | **✅ tested — no step-up** |
| User lookup | Admin | Search user | User record | — | read-only | none | ✅ |
| Listing review | Admin | Approve/reject | Status change | Host | `Listing.status` | ✅ audit row | ⚠️ blocked by jurisdiction |
| Booking visibility | Admin | View bookings | Booking list | — | read-only | none | ⚠️ `PAYMENT_PENDING` not listed |
| Booking intervention | Admin | Cancel booking | Cascade + refund | Guest/Host | `Booking`,`WalletEntry` | ⚠️ 1 row for 3 records | ✅ |
| Inventory release | Admin | Release hold | Dates freed | Host | `Booking` | none | ✖ no endpoint |
| Payment-state visibility | Admin | View proofs | Proof queue | — | `PaymentProof` | none | ✅ |
| Payment decision | Admin | Approve/reject proof | Status change | Guest | `PaymentProof` | ✅ audit row | ✅ |
| ID document review | Admin | Open document | Bytes + attachment header | — | read-only | ✅ audit row | ✅ |
| Driver document review | Admin | Open document | Bytes | — | read-only | **✖ no audit row** | ✅ |
| Listing document review | Admin | Open document | Bytes | — | read-only | **✖ no audit row** | ✅ |
| Legal hold | Admin | Set/clear hold | Hold state | — | `ListingDocument.legalHold` | ✅ | ⚠️ silently cleared by typo |
| Driver registry export | Admin | Export CSV | CSV of drivers | — | read-only | **✖ unaudited** | ✅ |
| Audit-log visibility | Admin | Read audit log | Audit rows | Controller | `AdminAuditLog` | n/a | ✅ |
| Role visibility | Admin | View roles | Role list | — | — | — | ✖ no endpoint |
| Account suspension | Admin | Suspend user | Session killed | — | `User.status` | ✅ | ⚠️ driver only |

## 4. Controller / audit surfaces

| Check | Source of truth | Audit evidence | Governed recovery | Testability |
|---|---|---|---|---|
| Booking lifecycle integrity | `Booking.status` | **none on create** | ✖ no exit from `PAYMENT_PENDING` | ✅ |
| Inventory release | `Booking` + availability | none | ✖ none | ✅ |
| Payment-state consistency | `PaymentProof` | partial | ⚠️ | ✅ |
| Financial-state separation | `WalletEntry` | none on create | ✖ unbacked balance found | ✅ |
| Document access logging | `AdminAuditLog` | 1 of 5 routes | n/a | ✅ |
| Role separation / least privilege | route guards | n/a | n/a | ✅ 15/15 denied |
| Retention / legal hold | `ListingDocument` | partial | ⚠️ 4 of 5 null clock | ✅ |
| Account closure | `User` | none | ✖ permanently blocked | ✅ |
| Doc-vs-code truthfulness | tracked docs | n/a | n/a | ✅ 2 claims false |

---

## 5. External-service dependency map

| Dependency | State during validation | Effect |
|---|---|---|
| Local Postgres | Connected | Full DB observation available |
| Cloudflare R2 | **Not connected** | Storage exercised on local driver only; durability unproven |
| Upstash Redis | Not configured | In-memory limiter; fail-open behaviour not exercised at scale |
| Resend (email) | Not configured | No notification path testable; OTP via `devCode` |
| Twilio (SMS) | Not configured | Phone OTP not tested |
| Stripe | Key present, **not exercised** | Card payment untested by instruction |
| Anthropic | Key present, **not exercised** | AI insights untested by instruction |

---

## 6. Test-data requirements observed

Synthetic `@sybnb.test` accounts per role; synthetic 1×1 PNG and `%PDF-1.7` fixtures for uploads; no real personal data, identity documents, or payment instruments used at any point by any agent.

**One environment intervention, disclosed:** the host agent temporarily flipped a jurisdiction-compliance row to reach downstream workflows, then restored it. Everything it reached that way is marked ⚠️ in §2 and is **not** evidence that the path works in the shipped configuration.
