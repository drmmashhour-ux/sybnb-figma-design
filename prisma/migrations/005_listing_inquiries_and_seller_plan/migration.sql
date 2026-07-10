-- Extends message_threads so RENTALS/BUY "contact owner" requests get a real, persistent
-- thread (reusing the same messages system built for STAYS bookings) instead of writing to
-- localStorage only. A thread is now anchored by EITHER a booking OR a (listing, guest) pair.
ALTER TABLE message_threads
  ALTER COLUMN booking_id DROP NOT NULL,
  ADD COLUMN listing_id uuid REFERENCES listings(id) ON DELETE CASCADE,
  ADD COLUMN guest_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX message_threads_listing_id_guest_id_key ON message_threads (listing_id, guest_id);

ALTER TABLE message_threads
  ADD CONSTRAINT message_threads_booking_or_listing_chk
  CHECK (
    (booking_id IS NOT NULL AND listing_id IS NULL AND guest_id IS NULL)
    OR (booking_id IS NULL AND listing_id IS NOT NULL AND guest_id IS NOT NULL)
  );

-- Backs the real seller/dealer/developer plan-payment gate (server/routes/listings.mjs),
-- replacing the old client-only "admin lane" simulation in SellerAccountPage.tsx.
-- (seller_profiles table already existed but was never wired up until now.)
