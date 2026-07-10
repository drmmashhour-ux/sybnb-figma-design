# SYBNB STR Overnight Continuation Notes

## Completed Before Freeze

- STR client flow: search, account gate, agreement, booking, payment, admin review, dashboard continuation.
- STR host flow: host dashboard polished and stamped.
- STR admin flow: Figma V2 department groups applied.
- Admin buttons: accept, reject, hold, details, confirm, send to guest, send to host, dispute, refund, payout staging now have visible behavior.
- STR logo installed.
- English and Arabic STR movie assets installed.
- Google map capsule created for listing locations, with offline fallback.
- Claude review package created previously and verified.

## Current Clean Package

This folder is the clean base to continue from. Do not mix with older 3050 or 3052 server copies.

## Still Needs Production Hardening

- Real SMS delivery gateway.
- Live Sham Cash reconciliation API feed. Manual server-side reconciliation gate exists now, but production still needs direct Sham Cash/account integration.
- Stripe server-side PaymentIntent and webhook flow for credit-card payments.
- Real outbound notifications instead of local outbox prototype.
- Production file storage for payment proof and account documents.
- Production environment variables, database migration, and end-to-end staging test.

## Verified Backend Controls

- Server-side admin/host/driver role guard exists through `requireAuth`.
- Booking and payment ownership enforcement exists on backend routes.
- Admin payment approval writes audit log rows and wallet ledger hold/admin-share entries.
- Host booking confirmation requires SYBNB terms acceptance.
- Host payout release exists as a wallet ledger `RELEASE` entry after host confirmation.
- Host cancellation after paid booking triggers guest refund and host cancellation/admin fee ledger entries.

## Next Divisions To Audit

1. Advertising account/payment tunnel.
2. SR ride guest/driver tunnel.
3. Wallet/gift tunnel.
4. Finance reconciliation page.
5. Operations calendar.
6. IMMOContact.
7. AI Brain.
