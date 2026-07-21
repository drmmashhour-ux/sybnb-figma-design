-- Quebec driver compliance readiness (027): new SAAQ-specific document types, and a `country` field
-- on DriverProfile/DriverVehicle so a driver's documents/vehicle can be reviewed against the right
-- market's rules. This does NOT enable Quebec ride-matching -- SR/SIR stays geofenced to Syria
-- (assertSyriaCoords) until the real CTQ/SAAQ authorization exists and the jurisdiction profile is
-- flipped to APPROVED.

-- AlterEnum
ALTER TYPE "driver_document_type" ADD VALUE 'SAAQ_AUTHORIZED_DRIVER_PERMIT';
ALTER TYPE "driver_document_type" ADD VALUE 'CRIMINAL_RECORD_CHECK';

-- AlterTable
ALTER TABLE "driver_profiles" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'SY';

-- AlterTable
ALTER TABLE "driver_vehicles" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'SY';

-- AlterTable: CTQ Transportation System Operator fields (SR-division jurisdiction profiles only)
ALTER TABLE "jurisdiction_compliance_profiles" ADD COLUMN     "operator_respondent_name" TEXT;
ALTER TABLE "jurisdiction_compliance_profiles" ADD COLUMN     "operator_respondent_contact" TEXT;
ALTER TABLE "jurisdiction_compliance_profiles" ADD COLUMN     "operator_dispatcher_name" TEXT;
ALTER TABLE "jurisdiction_compliance_profiles" ADD COLUMN     "operator_dispatcher_contact" TEXT;
ALTER TABLE "jurisdiction_compliance_profiles" ADD COLUMN     "operator_insurance_reference" TEXT;
ALTER TABLE "jurisdiction_compliance_profiles" ADD COLUMN     "operator_authorization_number" TEXT;
