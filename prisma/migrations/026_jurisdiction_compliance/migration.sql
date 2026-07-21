-- Jurisdiction compliance (026): one row per (division, country, region) market SYBNB could operate
-- in. Nothing in that market can go live -- a STR listing cannot be APPROVED, an SR driver document
-- cannot be APPROVED -- unless its row here has status APPROVED. Every market starts PENDING
-- (fail-closed) until an admin/legal review explicitly flips it.

-- CreateEnum
CREATE TYPE "jurisdiction_division" AS ENUM ('STR', 'SR');

-- CreateEnum
CREATE TYPE "jurisdiction_compliance_status" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');

-- CreateTable
CREATE TABLE "jurisdiction_compliance_profiles" (
    "id" TEXT NOT NULL,
    "division" "jurisdiction_division" NOT NULL,
    "country_code" TEXT NOT NULL,
    "region_code" TEXT NOT NULL DEFAULT '',
    "status" "jurisdiction_compliance_status" NOT NULL DEFAULT 'PENDING',
    "tourism_required" BOOLEAN NOT NULL DEFAULT false,
    "tourism_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "tourism_notes" TEXT,
    "transport_required" BOOLEAN NOT NULL DEFAULT false,
    "transport_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "transport_notes" TEXT,
    "tax_required" BOOLEAN NOT NULL DEFAULT false,
    "tax_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "tax_notes" TEXT,
    "platform_required" BOOLEAN NOT NULL DEFAULT false,
    "platform_satisfied" BOOLEAN NOT NULL DEFAULT false,
    "platform_notes" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdiction_compliance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jurisdiction_compliance_profiles_division_country_code_regi_key" ON "jurisdiction_compliance_profiles"("division", "country_code", "region_code");

-- AddForeignKey
ALTER TABLE "jurisdiction_compliance_profiles" ADD CONSTRAINT "jurisdiction_compliance_profiles_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
