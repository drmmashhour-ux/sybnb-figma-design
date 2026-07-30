# SYBNB STR — Launch Checklist

The code blockers are fixed. What remains are **configuration/operations steps that need the owner's
accounts and secrets** (they can't be done from the codebase). Do these in order.

## 1. Create the first admin (unblocks all approvals)
The control center can only *create* staff once an admin exists — so seed the first one directly.
Run against the **production** database (set its `DATABASE_URL` in the environment first):

```bash
ADMIN_EMAIL=info@sybnb.app ADMIN_PASSWORD='<choose a strong password>' ADMIN_NAME='SYBNB Admin' npm run bootstrap:admin
```

Then sign in at **/host/stays → the Partner/Admin gate** with that email + password (once email OTP is on, step 2).

## 2. Set the production secrets (Vercel → Project → Settings → Environment Variables)
| Variable | Enables | Without it |
|---|---|---|
| `RESEND_API_KEY` (or `SMTP_HOST`/`SMTP_*`) | **Email OTP** for sign-up / staff login | signup + admin login are blocked (503) |
| `STRIPE_SECRET_KEY` | **Card payments** (guest + host plan) | card option hidden; only Sham Cash (manual) works |
| `ANTHROPIC_API_KEY` | Real **AI** descriptions + pricing insights | AI silently falls back to the deterministic template |
| *(remove)* `VITE_GOOGLE_MAPS_API_KEY` | — | delete it; the map is free OSM now (stops Mastercard billing) |

Redeploy after changing env vars.

## 3. First real inventory
- A host lists a place (partner sign-in → 6-step wizard → submit).
- The admin approves it in the review queue → it appears on the search map with a working pin + directions.
- (The card now shows the host's **plan + fee** so the admin can confirm the Sham Cash plan payment before approving.)

## 4. Money model decisions (business, not code)
- **Tax**: `STR_TAX_RATE = 0` today. Activating a real rate needs collection + remittance wiring first — see `docs/product/STR_TAX_DECISION_REQUEST.md`.
- **Payouts**: released manually by an admin after an out-of-band Sham Cash transfer (record the reference). No automated payout rail until a PSP is wired.
- **Host plan fee**: self-attested in the wizard, **verified by the admin at approval** (now visible on the review card). A fully automated charge requires `STRIPE_SECRET_KEY` (step 2).

## Already fixed in code (this session)
- Free OSM map + Get-directions; Hotel $100 plan; multi bed-type; required geocoded listing location.
- Partner-gate sign-in loop + clear Confirm-code feedback; AI "Write with AI" description capsule.
- **Sham Cash payment now submits a real server-side proof** (was faked/auto-approved).
- **Admin bootstrap** script + `npm run bootstrap:admin`.
- Admin review card shows the host's plan for payment verification.
