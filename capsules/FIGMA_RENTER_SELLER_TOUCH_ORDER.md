# SYBNB V6 - Renter / Seller Touch Capsule Figma Order

## Core Rule

Use the same capsule logic as STR:

- Search first.
- Client opens detail page.
- Any request, contact, payment, upload, or submission requires sign in / sign up first.
- Payment uses one reusable Payment Capsule.
- Filters use photo/symbol tiles, counters, and touch chips.
- Location uses the shared Syria engine: governorate -> city -> area/street.

## Renter Flow

### renter-search

Tablet 1024px:

- Header: logo, division name, sign in, sign up, EN/AR.
- Search capsule: governorate, city, area/street, optional date.
- Full Syria location data from STR.
- Visual filter panel:
  - Property type tiles.
  - Bedroom counter.
  - Bathroom counter.
  - Bed type chips.
  - Amenities symbols/photos.
- Results grid with real listing photos.
- Result action before account: "Open account first".

### renter-listing-detail

- Full-bleed property photo.
- SYBNB Protected badge.
- Trust chips.
- Location / host / terms tabs.
- Four-step "How booking works":
  1. Search.
  2. Open account.
  3. Send request.
  4. Pay through capsule after approval.
- CTAs: Send request + Contact.

### renter-account-gate

- Sign up / Sign in tabs.
- Fields: first name, last name, email, phone, password, repeat password.
- Send verification code.
- OTP row.
- Return to selected listing after confirmation.

### renter-payment-capsule

- Four payment method tiles: credit card, bank transfer, local wallet, Sham Cash.
- Gold amount box.
- Payment code.
- Tracking code.
- Upload proof.
- Status pill: waiting for proof review.

## Buyer Flow

Use the same renter capsule structure, but label it as the buyer path.

### buyer-search

- Route: `/buy`.
- Header: logo, شراء عقار / Buy Property, sign in, sign up, EN/AR.
- Search capsule: same STR Syria location engine, no native dropdowns.
- Main group tiles: apartment, villa, room, office, shop, land.
- Results use BUY inventory only.
- Result action before account: "Open buyer account first".

### buyer-listing-detail

- Property photo, SYBNB Protected badge, owner trust chips.
- Four-step buyer flow:
  1. Search sale properties.
  2. Open buyer account.
  3. Upload buyer documents.
  4. Send visit/contact request through IMMOContact.

### buyer-account-gate

- Same sign up / sign in capsule as renter.
- Phone code required before continuing.
- Return path: `/buy`.

### buyer-request-capsule

- No direct guest-visible platform commission.
- Buyer uploads ID, proof of funds or financing, and supporting documents.
- Status: waiting for owner/admin/IMMOContact review.

## Seller Flow

### seller-entry-choice

Two cards:

- Sell by yourself / "بيع عقارك بنفسك": seller buys a plan, controls listing.
- Sell through SYBNB network / "بيع بواسطة المنصة": SYBNB handles buyer contact and closes with 5% commission after sale.

### seller-signup-verify

- Four-step progress bar.
- Full signup form.
- Send phone code.
- OTP verification.
- No seller action before account.

### seller-document-upload

- Required upload cards:
  - ID.
  - Ownership document.
  - Property photo.
  - Authorization, optional if not owner.
- Next disabled until required documents exist.

### seller-plan-payment

- Plan cards: free, 50 USD, 120 USD.
- Payment method chips.
- Payment code and operation number.
- Proof upload.
- Status: waiting for document/payment review.

### seller-by-platform

- Platform handles list:
  - Marketing.
  - Buyer communication.
  - Document review.
  - Offer management.
- Status: waiting for admin review.
- WhatsApp / IMMOContact toggle.
- Commission note: 5% after completed sale.

### seller-listing-wizard

- Property type tiles: apartment, villa, room, office, shop, land.
- Shared Syria location capsule.
- Bedroom / bathroom / floor steppers.
- Bed type chips.
- Amenities symbol grid.
- Seller documents upload before final review.

### payment-capsule-states

Five states:

1. Waiting for amount confirmation.
2. Ready to pay.
3. Waiting for proof review.
4. Waiting for admin confirmation.
5. Payment confirmed.

## Design Direction

- Dark SYBNB V6 style.
- Touch-screen first.
- No native dropdown visuals.
- Cards radius max 8px.
- Buttons large enough for tablet.
- Arabic first, English as secondary where needed.
- Keep renter, seller, STR visually related but division-labeled.
