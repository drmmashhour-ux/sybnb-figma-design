-- Jurisdiction-based pricing engine (030): tax rates, commission policies, and immutable pricing
-- snapshots, all effective-dated and province-activation-gated. Purely additive -- does not touch
-- any existing table, and the existing hardcoded rate constants (SR_COMMISSION_TIERS,
-- quebec-stay-tax.mjs, STR_ADMIN_COMMISSION_RATE) remain the seed/fallback defaults the resolver
-- falls back to when no active DB row exists, so zero behavior change for any existing booking/ride
-- until an admin explicitly activates a jurisdiction row.

-- CreateEnum
CREATE TYPE "jurisdiction_service_type" AS ENUM ('RIDE', 'STAY');

-- CreateEnum
CREATE TYPE "jurisdiction_tax_type" AS ENUM ('GST', 'QST', 'LODGING', 'REGULATORY_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "jurisdiction_calculation_base" AS ENUM ('ACCOMMODATION_ONLY', 'FARE_BASE', 'TOTAL_BOOKING');

-- CreateEnum
CREATE TYPE "jurisdiction_collector_type" AS ENUM ('PLATFORM', 'HOST_OR_DRIVER', 'DEPENDS_ON_REGISTRATION');

-- CreateTable
CREATE TABLE "jurisdiction_tax_rates" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "province" TEXT,
    "municipality" TEXT,
    "service_type" "jurisdiction_service_type" NOT NULL,
    "tax_type" "jurisdiction_tax_type" NOT NULL,
    "rate_parts" INTEGER NOT NULL,
    "calculation_base" "jurisdiction_calculation_base" NOT NULL,
    "collector_type" "jurisdiction_collector_type" NOT NULL,
    "rounding_rule" TEXT NOT NULL DEFAULT 'ROUND_HALF_UP',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "legally_reviewed_by_id" TEXT,
    "legally_reviewed_at" TIMESTAMP(3),
    "source_url" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdiction_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_commission_policies" (
    "id" TEXT NOT NULL,
    "country" TEXT,
    "province" TEXT,
    "service_type" "jurisdiction_service_type" NOT NULL,
    "policy_type" TEXT NOT NULL,
    "flat_rate_parts" INTEGER,
    "tiers" JSONB,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "legally_reviewed_by_id" TEXT,
    "legally_reviewed_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdiction_commission_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_snapshots" (
    "id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "province" TEXT,
    "breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jurisdiction_tax_rates_country_province_municipality_servic_idx" ON "jurisdiction_tax_rates"("country", "province", "municipality", "service_type", "tax_type", "effective_from");

-- CreateIndex
CREATE INDEX "jurisdiction_commission_policies_country_province_service_t_idx" ON "jurisdiction_commission_policies"("country", "province", "service_type", "effective_from");

-- CreateIndex
CREATE INDEX "pricing_snapshots_subject_type_subject_id_idx" ON "pricing_snapshots"("subject_type", "subject_id");
