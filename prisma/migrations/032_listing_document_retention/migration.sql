-- CreateEnum
CREATE TYPE "listing_document_status" AS ENUM ('PENDING_REVIEW', 'ADMIN_REVIEWED_TEST', 'REJECTED', 'EXPIRED', 'DIGITAL_VERIFICATION_PENDING', 'DIGITALLY_VERIFIED');

-- AlterTable
ALTER TABLE "listing_documents" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "legal_hold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legal_hold_reason" TEXT,
ADD COLUMN     "legal_hold_set_at" TIMESTAMP(3),
ADD COLUMN     "legal_hold_set_by_id" TEXT,
ADD COLUMN     "retention_delete_after" TIMESTAMP(3),
ALTER COLUMN "asset_url" DROP NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "listing_document_status" NOT NULL DEFAULT 'PENDING_REVIEW';

-- CreateIndex
CREATE INDEX "listing_documents_status_idx" ON "listing_documents"("status");

-- CreateIndex
CREATE INDEX "listing_documents_retention_delete_after_idx" ON "listing_documents"("retention_delete_after");

-- AddForeignKey
ALTER TABLE "listing_documents" ADD CONSTRAINT "listing_documents_legal_hold_set_by_id_fkey" FOREIGN KEY ("legal_hold_set_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
