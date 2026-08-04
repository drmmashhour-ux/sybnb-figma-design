-- Additive-only migration: adds btree indexes on hot read paths for 10K-user scale.
-- No columns, data, or constraints are changed; only new indexes are created.

-- listings: public search (GET /api/listings) filters status='APPROVED' and sorts by
-- createdAt (default) or priceMinor; division / price-range applied as residual filters.
-- A status-leading composite lets Postgres serve filter + sort from the index.
CREATE INDEX "listings_status_created_at_idx" ON "listings"("status", "created_at");
CREATE INDEX "listings_status_price_minor_idx" ON "listings"("status", "price_minor");

-- listings: expireOldListings() runs updateMany(status='APPROVED', expiresAt < now) on every
-- search request (opportunistic lifecycle sweep, no cron). This index bounds that sweep.
CREATE INDEX "listings_status_expires_at_idx" ON "listings"("status", "expires_at");

-- bookings: completeExpiredBookings() sweeps status='CONFIRMED' with checkOut < cutoff, and the
-- admin payouts list filters status='COMPLETED' ordered by checkOut. This serves both.
CREATE INDEX "bookings_status_check_out_idx" ON "bookings"("status", "check_out");
