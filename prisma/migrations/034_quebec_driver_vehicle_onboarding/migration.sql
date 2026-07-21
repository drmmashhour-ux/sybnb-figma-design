-- CreateEnum
CREATE TYPE "quebec_driver_onboarding_status" AS ENUM ('DRAFT', 'IDENTITY_PENDING', 'DRIVER_DOCUMENTS_PENDING', 'POLICE_CHECK_PENDING', 'TRAINING_PENDING', 'TAX_REGISTRATION_PENDING', 'VEHICLE_PENDING', 'INSURANCE_PENDING', 'ADMIN_REVIEW', 'APPROVED_INACTIVE', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "quebec_vehicle_onboarding_status" AS ENUM ('DRAFT', 'DOCUMENTS_PENDING', 'INSPECTION_PENDING', 'ADMIN_REVIEW', 'APPROVED_INACTIVE', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REJECTED');

-- CreateTable
CREATE TABLE "quebec_driver_onboarding" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "quebec_driver_onboarding_status" NOT NULL DEFAULT 'DRAFT',
    "license_number_encrypted" TEXT,
    "license_expires_at" TIMESTAMP(3),
    "police_check_expires_at" TIMESTAMP(3),
    "training_completed_at" TIMESTAMP(3),
    "status_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quebec_driver_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quebec_vehicle_onboarding" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "status" "quebec_vehicle_onboarding_status" NOT NULL DEFAULT 'DRAFT',
    "registration_expires_at" TIMESTAMP(3),
    "insurance_expires_at" TIMESTAMP(3),
    "inspection_expires_at" TIMESTAMP(3),
    "status_reason" TEXT,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quebec_vehicle_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quebec_driver_onboarding_user_id_key" ON "quebec_driver_onboarding"("user_id");

-- CreateIndex
CREATE INDEX "quebec_driver_onboarding_status_idx" ON "quebec_driver_onboarding"("status");

-- CreateIndex
CREATE UNIQUE INDEX "quebec_vehicle_onboarding_vehicle_id_key" ON "quebec_vehicle_onboarding"("vehicle_id");

-- CreateIndex
CREATE INDEX "quebec_vehicle_onboarding_status_idx" ON "quebec_vehicle_onboarding"("status");

-- AddForeignKey
ALTER TABLE "quebec_driver_onboarding" ADD CONSTRAINT "quebec_driver_onboarding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "driver_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_driver_onboarding" ADD CONSTRAINT "quebec_driver_onboarding_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_onboarding" ADD CONSTRAINT "quebec_vehicle_onboarding_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "driver_vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quebec_vehicle_onboarding" ADD CONSTRAINT "quebec_vehicle_onboarding_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
