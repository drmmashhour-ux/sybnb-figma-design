-- Instant Book: host-controlled per-listing toggle that skips the manual host-confirmation
-- step after payment is approved (mirrors Airbnb's Instant Book vs Request to Book).
ALTER TABLE listings
  ADD COLUMN instant_book_enabled boolean NOT NULL DEFAULT false;
