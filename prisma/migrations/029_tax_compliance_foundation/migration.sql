-- Québec/Canada tax-compliance foundation (029): tax profiles (driver + host), Part XX federal
-- reporting ledger, and compliance feature flags. Purely additive -- does not touch any existing
-- table, and does not change how the existing 12/11/10/9% Ride commission or 13% Stay commission
-- are calculated (server/lib/sr-payments.mjs, server/lib/finance-ledger.mjs are untouched).

-- CreateEnum
CREATE TYPE "tax_profile_subject_type" AS ENUM ('DRIVER', 'HOST');

-- CreateEnum
CREATE TYPE "tax_profile_business_type" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "tax_identifier_type" AS ENUM ('SIN', 'TIN', 'OTHER');

-- CreateEnum
CREATE TYPE "gst_qst_treatment" AS ENUM ('HOST_REGISTERED', 'PLATFORM_COLLECTS');

-- CreateEnum
CREATE TYPE "part_xx_activity_type" AS ENUM ('RIDE', 'ACCOMMODATION');

-- CreateEnum
CREATE TYPE "part_xx_filing_status" AS ENUM ('DRAFT', 'VALIDATED', 'FILED', 'ACCEPTED', 'REJECTED', 'CORRECTED');

-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_type" "tax_profile_subject_type" NOT NULL,
    "legal_first_name" TEXT NOT NULL,
    "legal_last_name" TEXT NOT NULL,
    "legal_business_name" TEXT,
    "business_type" "tax_profile_business_type" NOT NULL DEFAULT 'INDIVIDUAL',
    "date_of_birth" TIMESTAMP(3),
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "tax_residence_country" TEXT NOT NULL,
    "tax_residence_region" TEXT,
    "tax_identifier_type" "tax_identifier_type" NOT NULL,
    "tax_identifier_ciphertext" TEXT NOT NULL,
    "tax_identifier_last4" TEXT NOT NULL,
    "gst_registered" BOOLEAN NOT NULL DEFAULT false,
    "gst_number" TEXT,
    "qst_registered" BOOLEAN NOT NULL DEFAULT false,
    "qst_number" TEXT,
    "neq_number" TEXT,
    "payout_account_ciphertext" TEXT,
    "payout_account_last4" TEXT,
    "gst_qst_treatment" "gst_qst_treatment",
    "gst_qst_treatment_effective_at" TIMESTAMP(3),
    "gst_qst_treatment_decided_by_id" TEXT,
    "gst_qst_treatment_decided_at" TIMESTAMP(3),
    "consent_regulatory_reporting" BOOLEAN NOT NULL DEFAULT false,
    "certified_accurate" BOOLEAN NOT NULL DEFAULT false,
    "certified_accurate_at" TIMESTAMP(3),
    "verification_status" "id_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "verification_source" TEXT,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_xx_records" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "activity_type" "part_xx_activity_type" NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "gross_consideration_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "activity_count" INTEGER NOT NULL,
    "platform_fees_minor" INTEGER NOT NULL,
    "taxes_withheld_minor" INTEGER NOT NULL DEFAULT 0,
    "refunds_minor" INTEGER NOT NULL DEFAULT 0,
    "property_address" TEXT,
    "status" "part_xx_filing_status" NOT NULL DEFAULT 'DRAFT',
    "filing_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_xx_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "part_xx_filings" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "status" "part_xx_filing_status" NOT NULL DEFAULT 'DRAFT',
    "t619_transmission_ref" TEXT,
    "submitted_xml" TEXT,
    "cra_response" JSONB,
    "submitted_at" TIMESTAMP(3),
    "submitted_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "error_details" JSONB,
    "correction_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "part_xx_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_profiles_user_id_subject_type_key" ON "tax_profiles"("user_id", "subject_type");

-- CreateIndex
CREATE UNIQUE INDEX "part_xx_records_seller_id_activity_type_year_quarter_key" ON "part_xx_records"("seller_id", "activity_type", "year", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_feature_flags_key_key" ON "compliance_feature_flags"("key");

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_xx_records" ADD CONSTRAINT "part_xx_records_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "part_xx_records" ADD CONSTRAINT "part_xx_records_filing_id_fkey" FOREIGN KEY ("filing_id") REFERENCES "part_xx_filings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
