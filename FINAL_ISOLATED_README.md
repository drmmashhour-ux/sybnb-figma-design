# SYBNB STR Final Isolated Package - 2026-07-05

Status: FINAL ISOLATED STR BASE
Server used during human test: 127.0.0.1:3053
Stamp: FINAL - JULY 5 CORRECTED - STR / Stay Trust Relax

This folder is a clean isolated copy of the current SYBNB V6 working edition after the short-term rental human-test corrections.

Included:
- React/Vite source in `src/`
- Public assets in `public/`
- Server prototype routes in `server/`
- Prisma schema in `prisma/`
- Build files: `package.json`, `package-lock.json`, `index.html`, `tsconfig.json`, `vite.config.ts`
- STR logo and English/Arabic STR movie assets
- Latest STR admin/host/client flow corrections

Not included:
- `node_modules`
- old 3050 / 3052 experiment folders
- browser cache
- deployment credentials

Verified backend controls already present:
- Server-side role authorization for admin/host/driver routes through `requireAuth`.
- Server-side booking/payment ownership checks for guest, host/listing owner, admin/support access.
- Admin payment approval writes audit logs and wallet ledger entries.
- Host confirmation requires SYBNB terms acceptance before release.
- Host payout release is recorded as a wallet ledger `RELEASE` entry after confirmation.
- Manual server-side Sham Cash reconciliation is required before approving Sham Cash/local-wallet proofs.

Known production hardening still required:
- Real SMS/OTP gateway on backend.
- Live Sham Cash API reconciliation feed instead of manual admin-entered balance.
- Stripe server-side PaymentIntent and webhook flow for card payments.
- Real outbound notification delivery instead of local in-app outbox prototype.
- Production file storage for proof/document uploads.
- Production environment variables, database migration, and end-to-end staging test.

Recommended next command after extracting:

```bash
npm install
npm run build
```
