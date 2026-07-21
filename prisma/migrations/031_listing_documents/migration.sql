-- CreateEnum
CREATE TYPE "listing_document_type" AS ENUM ('CITQ_CERTIFICATE');

-- CreateTable
CREATE TABLE "listing_documents" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "type" "listing_document_type" NOT NULL,
    "asset_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "status" "id_document_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_documents_status_idx" ON "listing_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "listing_documents_listing_id_type_key" ON "listing_documents"("listing_id", "type");

-- AddForeignKey
ALTER TABLE "listing_documents" ADD CONSTRAINT "listing_documents_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_documents" ADD CONSTRAINT "listing_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
