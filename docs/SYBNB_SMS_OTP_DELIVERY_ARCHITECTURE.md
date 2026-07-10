# SYBNB SMS / OTP Delivery Architecture

## Current Prototype State

The current V6 prototype has a local verification-code engine:

- File: `src/engines/security/verificationCodeEngine.ts`
- Used by: `src/modules/account/StaffAccessPage.tsx`
- Guest account page currently shows a demo message and local confirmation flow.

This is acceptable for local testing only. It is not production SMS.

## Production Rule

Verification codes must be generated, stored, sent, and verified on the backend.

The browser must never:
- Generate the real OTP.
- Display the OTP for real users.
- Store the OTP in client-side state as the trusted source.
- Decide by itself that a phone number is verified.

## Correct Flow

1. Client enters phone number.
2. Browser calls backend:

```http
POST /api/otp/send
```

3. Backend:
- normalizes the phone number,
- checks rate limits,
- generates a 6-digit OTP,
- hashes the OTP,
- stores phone hash, purpose, expiry, attempt count, and status,
- sends the SMS through an approved SMS provider.

4. Client enters the code.
5. Browser calls backend:

```http
POST /api/otp/verify
```

6. Backend:
- compares the submitted code with the stored hash,
- checks expiry and attempts,
- marks the phone as verified,
- allows account creation, sign-in, staff access, payment proof, or wallet claim.

## Required Backend Tables

Suggested table: `VerificationCode`

Fields:
- `id`
- `phoneHash`
- `purpose`
- `codeHash`
- `expiresAt`
- `attempts`
- `maxAttempts`
- `status`
- `sentProvider`
- `providerMessageId`
- `createdAt`
- `verifiedAt`

## SMS Provider Adapter

Create one backend adapter:

```ts
sendSms({
  to: phone,
  body: message,
  purpose: 'guest-login' | 'staff-login' | 'seller-login' | 'payment-proof'
})
```

Provider choices must be verified before launch in Syria. The system should support swapping providers without changing the frontend.

## Message Text

Arabic:

> رسالة من SYBNB: رمز التحقق الخاص بك هو 123456. صالح لمدة 10 دقائق. لا تشارك هذا الرمز مع أي شخص.

English:

> SYBNB verification code: 123456. Valid for 10 minutes. Do not share this code with anyone.

## Security Rules

- OTP expires after 10 minutes.
- Maximum 5 attempts.
- Rate limit per phone and IP.
- Lock repeated abuse temporarily.
- Do not log the plain OTP.
- Do not send admin/staff codes from frontend.
- Do not approve payment, booking, wallet, or staff access from URL query flags.

## Where To Apply

Use the same backend OTP engine in:

- Guest sign up / sign in
- Staff admin login
- Host login
- Driver login
- Advertising client account
- Wallet gift claim
- Payment proof confirmation

## Current Recommendation

Keep the local demo code visible only in local prototype mode. Before production, replace all visible demo-code behavior with backend `/api/otp/send` and `/api/otp/verify`.

