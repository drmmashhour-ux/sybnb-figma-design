# Reviewer demo accounts (App Store Connect / Play Console)

Both stores reject an app they can't get past the login screen. `scripts/seed-demo-accounts.mjs` seeds a
**pre-verified** demo customer, demo driver, and demo host so a reviewer sees the full flow without
uploading real ID. The accounts are flagged `isDemo` and carry **no admin role**.

## Running the seed (staging / production)

```
DEMO_ACCOUNT_PASSWORD='<pick-a-strong-password>' node scripts/seed-demo-accounts.mjs
```

Idempotent — safe to re-run at every deploy (keyed by fixed emails; re-running refreshes the password and
re-asserts verification, it does not duplicate accounts). The password is **never committed** — it comes
only from the `DEMO_ACCOUNT_PASSWORD` env var.

## Credentials to paste into the reviewer notes

| Account | Email | Password | Notes |
|---|---|---|---|
| Customer | `demo-customer@sybnb.app` | value of `DEMO_ACCOUNT_PASSWORD` | Guest; logs in with email + password directly. |
| Driver | `demo-driver@sybnb.app` | value of `DEMO_ACCOUNT_PASSWORD` | Road-ready (ID + licence + registration APPROVED). Staff sign-in requires the one-time access code sent by the configured provider. Only local development/tests may return `devCode`; hosted Preview never does. |
| Host | `demo-host@sybnb.app` | value of `DEMO_ACCOUNT_PASSWORD` | Owns one APPROVED demo listing. Staff sign-in requires the provider-delivered access code. |
| Preview QA | `qa@sybnb.app` | value of `DEMO_ACCOUNT_PASSWORD` | Preview-only convenience account with guest, host, driver and seller access; never admin. Password-only login requires `ALLOW_PREVIEW_DEMO_LOGIN=1` in Preview only. |

Paste the customer credentials as the primary reviewer login. If the reviewer needs the driver/host side,
include the note about the access code (and provide it, or point them at the code returned on sign-in in the
review build).
