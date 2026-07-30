# Payment capsule (isolated + reusable)

The single import surface for payments, so other platforms **config-clone** instead of re-deriving.
Mirrors the map capsule (`src/shared/maps/capsule/`) and the AI capsules.

## Public surface

| Export | What |
| --- | --- |
| `PaymentQr` | Reusable scan-to-pay QR renderer (wraps `qrcode` + loading state). One implementation instead of the copy-paste that lived in advertising / wallet / listing-plan surfaces. |
| `platformPaymentGateMethods` | The methods (`shamCash` / `localWallet` / `bankTransfer` / `creditCard`) with provider, labels, `destinationCode`, `requiresExternalProof`, `usesStripe`. |
| `createPlatformPaymentQrPayload` | Builds the JSON payload encoded into a QR (`amountMinor`, `currency`, `destinationCode`, `followCode`, `provider`, `purpose`). |
| `createStripeReference` | Stripe reference from a follow code. |
| `canStartPaymentGate` / `canUploadPaymentGateProof` / `canSendPaymentGateForReview` / `normalizePaymentGateMethod` | Gate predicates. |

## Usage

```tsx
import { PaymentQr, createPlatformPaymentQrPayload, platformPaymentGateMethods } from '../../shared/payments/capsule'

const payload = createPlatformPaymentQrPayload({
  amountMinor: priceUsd * 100,
  currency: 'USD',
  destinationCode: platformPaymentGateMethods.shamCash.destinationCode,
  followCode: 'PLAN-PLUS',
  provider: 'sham_cash',
  purpose: 'listing_plan',
})

<PaymentQr payload={payload} alt="Sham Cash payment QR" generatingLabel="Generating QR…" />
```

## Config-clone in another platform
Change only the `destinationCode`s (each platform's own Sham Cash / wallet / bank / Stripe accounts),
the `currency`, and the `purpose` strings. The QR renderer + gate predicates are platform-agnostic.

## Still to migrate onto this capsule (money code — do carefully, test-first)
- `SellerAdvertisingPaymentPage`, `SyrianLocalWalletPaymentPage` (both still inline their own QR).
- Stripe checkout client + `/api/payments/stripe/create-checkout-session` (booking checkout exists;
  listing-plan Stripe checkout not built) — gated on `STRIPE_SECRET_KEY` + `VITE_STRIPE_PUBLISHABLE_KEY`.
- `SellerListingWizard` plan payment already uses `PaymentQr` (the first surface migrated).
