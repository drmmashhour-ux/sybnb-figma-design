# Live Payment Test — End-to-End Verification (SYBNB)

**Goal:** prove the full money chain works in production: **book → pay by card → Stripe → webhook → booking shows "Confirmed"**, then **cancel → real card refund**. One successful run confirms everything the security/launch pass touched.

> ⚠️ **This uses REAL money.** Stripe is in **LIVE mode** — the card is genuinely charged. Do the whole run (including the cancel/refund at the end) so the money comes back to the card. Use the **cheapest available listing/dates** to keep the amount small. Test cards (4242…) are **rejected** in live mode — you must use a real card.

---

## What a successful run proves
Each step verifies one link in the chain:
1. Booking created → **PAYMENT_PENDING** (app logic + DB)
2. Stripe Checkout opens with the **correct amount** (charge-amount math)
3. Payment succeeds → **Stripe dashboard shows the charge** (live keys work)
4. Stripe fires `checkout.session.completed` → **webhook delivers 200** (webhook + WAF bypass)
5. Booking flips to **CONFIRMED**, host sees it, payment is APPROVED (webhook → `finalizeStripeSession`)
6. Cancel the booking → **money refunded to the card** in Stripe (the real-refund system)

---

## Before you start
- A **guest** account (or be ready to sign up — you'll receive an email OTP; this also confirms OTP delivery works).
- A **real payment card** you control.
- Access to the **Stripe dashboard** (live mode) and an **admin** login for sybnb.app.
- Pick a **low-priced listing + short dates** to minimize the charge.

---

## Part A — Book and pay (the guest)
1. Go to **https://sybnb.app**, open a listing, pick dates, and start the booking.
2. When prompted, **sign in / sign up** as a guest.
   - ✅ *Checkpoint (OTP):* if signing up, the email code should arrive within a minute. If it doesn't, OTP email delivery needs attention (separate from this test).
3. Submit the booking. It should now show a **"Pay now"** / payment-pending state.
   - ✅ *Checkpoint:* the booking exists and is awaiting payment (not "Confirmed" yet).
4. Tap **Pay by card** → you're redirected to **Stripe Checkout**.
   - ✅ *Checkpoint (amount):* the amount on the Stripe page **matches the total shown in the app** (stay + cleaning + tax + any protection). If it's wrong (e.g. $0.50), stop and report — that's the charge-amount math.
5. Enter your **real card** and pay.
6. You're redirected back to sybnb.app.

## Part B — Confirm the chain (verify in 3 places)
7. **In the app (guest "Trips"):** within a few seconds the booking should read **"Confirmed"** (not still "Payment pending").
   - ✅ *Checkpoint:* this is the headline result — it means the webhook fired and finalized the booking. Also open the **receipt / print** to confirm it renders.
8. **In the Stripe dashboard (live mode → Payments):** a **successful payment** for the right amount appears.
   - ✅ *Checkpoint:* real charge captured.
9. **In Stripe → Developers → Webhooks:** the `checkout.session.completed` event shows **delivered / 200**.
   - ✅ *Checkpoint:* the webhook reached the app *through* the WAF bypass and was accepted. (A `4xx`/`5xx` here is the thing to catch.)
10. **In the admin Office dashboard (`/admin/office`):** "Approved payments (gross)" and "Bookings" reflect the new paid booking.
    - ✅ *Checkpoint:* server-side accounting recorded it.

## Part C — Refund (recover the money + test refunds)
11. As **admin**, open the booking and **cancel / force-cancel** it (or cancel as the guest, per your refund policy).
12. **In the app:** the booking shows **cancelled**, and no further payment is requested.
13. **In the Stripe dashboard:** a **refund** for the charge appears against the original payment.
    - ✅ *Checkpoint:* money is on its way back to the card (card→card refund, not an internal wallet credit). This proves the real-refund system built this session.

---

## If something fails — where to look
| Symptom | Likely cause |
|---|---|
| Stripe page shows the **wrong amount** | charge-amount math (`stripeChargeAmount`) — report it |
| Paid, but booking **stuck on "Payment pending"** | webhook didn't finalize — check Stripe → Webhooks for a non-200 on `checkout.session.completed`; confirm the WAF **bypass** on `/api/payments/stripe/webhook` is intact and `STRIPE_WEBHOOK_SECRET` matches the live endpoint |
| Webhook shows **403 / challenge HTML** | WAF is challenging the webhook — the bypass rule was lost; re-add it |
| Card **rejected** with "test card" message | you used a test card (4242…) in live mode — use a real card |
| No OTP email at signup | email/OTP delivery config (Resend domain / `EMAIL_PROVIDER`) — separate from payments |
| Refund not in Stripe | refund path — capture the booking id and the app's response and report |

---

## One-run summary (tick these)
- [ ] Booking created, awaiting payment
- [ ] Stripe amount matched the app total
- [ ] Real card charged (Stripe shows the payment)
- [ ] `checkout.session.completed` webhook delivered 200
- [ ] Booking flipped to **Confirmed** in the app
- [ ] Office dashboard reflects the paid booking
- [ ] Cancel → **refund appears in Stripe** (money back on the card)

All seven ticked = the entire payment + refund chain is proven in production.
