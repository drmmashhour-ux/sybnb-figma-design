-- SR TRUST layer: driver vetting documents + masked ride messaging + two-way ride ratings.
-- (Renumbered from the agent's 014 to 015 so it does not collide with the safety-layer migration.)
-- driver_documents.status reuses the existing id_document_status enum.

CREATE TYPE "driver_document_type" AS ENUM ('LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE');
CREATE TYPE "ride_participant_role" AS ENUM ('RIDER', 'DRIVER');

-- Driver vetting beyond ID. asset_url holds the private storage key (randomUUID().ext), never a
-- public URL. One active row per (driver, type): re-upload upserts back to PENDING_REVIEW.
CREATE TABLE "driver_documents" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "driver_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "type" "driver_document_type" NOT NULL,
    "asset_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "status" "id_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "driver_documents_driver_user_id_type_key" ON "driver_documents"("driver_user_id", "type");
CREATE INDEX "driver_documents_status_idx" ON "driver_documents"("status");

-- Masked in-app ride contact channel. Scoped to a ride, no email/phone ever stored or returned.
CREATE TABLE "ride_messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "ride_id" uuid NOT NULL REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "sender_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "sender_role" "ride_participant_role" NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ride_messages_ride_id_created_at_idx" ON "ride_messages"("ride_id", "created_at");

-- Two-way ride ratings. safety_flag feeds the matching exclusion.
CREATE TABLE "ride_ratings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "ride_id" uuid NOT NULL REFERENCES "ride_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "rater_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "rated_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "rater_role" "ride_participant_role" NOT NULL,
    "stars" INTEGER NOT NULL,
    "safety_flag" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ride_ratings_ride_id_rater_user_id_key" ON "ride_ratings"("ride_id", "rater_user_id");
CREATE INDEX "ride_ratings_rated_user_id_safety_flag_idx" ON "ride_ratings"("rated_user_id", "safety_flag");
CREATE INDEX "ride_ratings_rater_user_id_safety_flag_idx" ON "ride_ratings"("rater_user_id", "safety_flag");
