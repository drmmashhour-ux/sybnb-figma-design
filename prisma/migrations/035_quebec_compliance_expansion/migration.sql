-- Expanded Québec driver/vehicle compliance profile, versioned compliance documents (driver +
-- vehicle), and legal-hold-safe versioning for ListingDocument. Hand-authored additive-only SQL
-- (this project applies migrations via raw psql, not `prisma migrate dev`/`db push`, because of
-- unrelated schema drift on the shared dev database -- see prior migrations' notes). TEST MODE only.

-- ---- New enums ----
CREATE TYPE "quebec_compliance_item_status" AS ENUM ('NOT_STARTED', 'SUBMITTED', 'ADMIN_REVIEWED_TEST', 'REJECTED');
CREATE TYPE "malware_scan_status" AS ENUM ('PENDING', 'QUARANTINED', 'NOT_IMPLEMENTED', 'CLEAN');
CREATE TYPE "quebec_driver_document_type" AS ENUM (
  'DRIVERS_LICENSE', 'DRIVING_RECORD_ABSTRACT', 'POLICE_BACKGROUND_CHECK', 'SAAQ_AUTHORIZED_DRIVER_PERMIT',
  'PROOF_OF_TRAINING_COMPLETION', 'FRENCH_LANGUAGE_ATTESTATION', 'GST_REGISTRATION', 'QST_REGISTRATION',
  'REVENU_QUEBEC_OPERATOR_FILE', 'PROOF_OF_IDENTITY', 'PROOF_OF_ADDRESS'
);
CREATE TYPE "quebec_vehicle_document_type" AS ENUM (
  'VEHICLE_REGISTRATION', 'PROOF_OF_INSURANCE', 'SAAQ_MECHANICAL_INSPECTION', 'VEHICLE_OWNERSHIP_PROOF',
  'ACCESSIBILITY_CERTIFICATION', 'COMMERCIAL_PLATE_REGISTRATION', 'VEHICLE_PHOTO'
);

-- ---- Expand quebec_driver_onboarding ----
ALTER TABLE "quebec_driver_onboarding"
  ADD COLUMN "legal_name_encrypted" TEXT,
  ADD COLUMN "legal_name_last4" TEXT,
  ADD COLUMN "age_eligibility_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "license_class" TEXT,
  ADD COLUMN "driving_experience_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "driving_experience_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "french_attestation_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "french_attestation_confirmed_at" TIMESTAMP(3),
  ADD COLUMN "gst_status" "quebec_compliance_item_status" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "qst_status" "quebec_compliance_item_status" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "operator_file_status" "quebec_compliance_item_status" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "sev_srs_status" "quebec_compliance_item_status" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "assigned_reviewer_id" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "quebec_driver_onboarding"
  ADD CONSTRAINT "quebec_driver_onboarding_assigned_reviewer_id_fkey"
  FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- ---- Expand quebec_vehicle_onboarding ----
ALTER TABLE "quebec_vehicle_onboarding"
  ADD COLUMN "vin_encrypted" TEXT,
  ADD COLUMN "vin_last4" TEXT,
  ADD COLUMN "odometer_km" INTEGER,
  ADD COLUMN "door_count" INTEGER,
  ADD COLUMN "seat_count" INTEGER,
  ADD COLUMN "accessibility_info" JSONB,
  ADD COLUMN "assigned_reviewer_id" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "quebec_vehicle_onboarding"
  ADD CONSTRAINT "quebec_vehicle_onboarding_assigned_reviewer_id_fkey"
  FOREIGN KEY ("assigned_reviewer_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- ---- New table: quebec_driver_documents ----
CREATE TABLE "quebec_driver_documents" (
  "id" TEXT NOT NULL,
  "onboarding_user_id" TEXT NOT NULL,
  "type" "quebec_driver_document_type" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "replaces_id" TEXT,
  "asset_url" TEXT,
  "mime_type" TEXT,
  "status" "listing_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
  "issuer" TEXT,
  "issued_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "malware_scan_status" "malware_scan_status" NOT NULL DEFAULT 'PENDING',
  "retention_delete_after" TIMESTAMP(3),
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "legal_hold_reason" TEXT,
  "legal_hold_set_by_id" TEXT,
  "legal_hold_set_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quebec_driver_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quebec_driver_documents_replaces_id_key" ON "quebec_driver_documents"("replaces_id");
CREATE INDEX "quebec_driver_documents_onboarding_user_id_type_is_current_idx" ON "quebec_driver_documents"("onboarding_user_id", "type", "is_current");
CREATE INDEX "quebec_driver_documents_status_idx" ON "quebec_driver_documents"("status");
CREATE INDEX "quebec_driver_documents_retention_delete_after_idx" ON "quebec_driver_documents"("retention_delete_after");

ALTER TABLE "quebec_driver_documents"
  ADD CONSTRAINT "quebec_driver_documents_onboarding_user_id_fkey" FOREIGN KEY ("onboarding_user_id") REFERENCES "quebec_driver_onboarding"("user_id") ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT "quebec_driver_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT "quebec_driver_documents_legal_hold_set_by_id_fkey" FOREIGN KEY ("legal_hold_set_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT "quebec_driver_documents_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "quebec_driver_documents"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- ---- New table: quebec_vehicle_documents ----
CREATE TABLE "quebec_vehicle_documents" (
  "id" TEXT NOT NULL,
  "onboarding_vehicle_id" TEXT NOT NULL,
  "type" "quebec_vehicle_document_type" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "replaces_id" TEXT,
  "asset_url" TEXT,
  "mime_type" TEXT,
  "status" "listing_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
  "issuer" TEXT,
  "issued_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "rejection_reason" TEXT,
  "malware_scan_status" "malware_scan_status" NOT NULL DEFAULT 'PENDING',
  "retention_delete_after" TIMESTAMP(3),
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "legal_hold_reason" TEXT,
  "legal_hold_set_by_id" TEXT,
  "legal_hold_set_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quebec_vehicle_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quebec_vehicle_documents_replaces_id_key" ON "quebec_vehicle_documents"("replaces_id");
CREATE INDEX "quebec_vehicle_documents_onboarding_vehicle_id_type_is_curre_idx" ON "quebec_vehicle_documents"("onboarding_vehicle_id", "type", "is_current");
CREATE INDEX "quebec_vehicle_documents_status_idx" ON "quebec_vehicle_documents"("status");
CREATE INDEX "quebec_vehicle_documents_retention_delete_after_idx" ON "quebec_vehicle_documents"("retention_delete_after");

ALTER TABLE "quebec_vehicle_documents"
  ADD CONSTRAINT "quebec_vehicle_documents_onboarding_vehicle_id_fkey" FOREIGN KEY ("onboarding_vehicle_id") REFERENCES "quebec_vehicle_onboarding"("vehicle_id") ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT "quebec_vehicle_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT "quebec_vehicle_documents_legal_hold_set_by_id_fkey" FOREIGN KEY ("legal_hold_set_by_id") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT "quebec_vehicle_documents_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "quebec_vehicle_documents"("id") ON UPDATE CASCADE ON DELETE SET NULL;

-- ---- Version ListingDocument for legal-hold-safe replacement ----
-- Existing rows all become version 1 / isCurrent = true (defaults handle backfill); the compound
-- uniqueness moves from (listing_id, type) to (listing_id, type, version) so a held row and its
-- replacement can coexist. "Current" document lookup is enforced in application code (isCurrent),
-- not by a DB constraint, matching the same discipline used for the two new document tables above.
ALTER TABLE "listing_documents"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "replaces_id" TEXT;

DROP INDEX "listing_documents_listing_id_type_key";
CREATE UNIQUE INDEX "listing_documents_listing_id_type_version_key" ON "listing_documents"("listing_id", "type", "version");
CREATE UNIQUE INDEX "listing_documents_replaces_id_key" ON "listing_documents"("replaces_id");
CREATE INDEX "listing_documents_listing_id_type_is_current_idx" ON "listing_documents"("listing_id", "type", "is_current");

ALTER TABLE "listing_documents"
  ADD CONSTRAINT "listing_documents_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "listing_documents"("id") ON UPDATE CASCADE ON DELETE SET NULL;
