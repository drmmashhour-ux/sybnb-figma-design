-- Store-readiness backend (024): account-deletion fields, demo flag, report + block UGC-safety tables.

-- AlterEnum: account can now be self-CLOSED (anonymize-and-retain), distinct from admin-DELETED.
ALTER TYPE "account_status" ADD VALUE IF NOT EXISTS 'CLOSED';

-- CreateEnum
CREATE TYPE "report_subject_type" AS ENUM ('LISTING', 'REVIEW', 'SELLER', 'USER', 'RIDE', 'BOOKING');
CREATE TYPE "report_status" AS ENUM ('OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporter_user_id" TEXT NOT NULL,
    "subject_type" "report_subject_type" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" "report_status" NOT NULL DEFAULT 'OPEN',
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" TEXT NOT NULL,
    "blocker_user_id" TEXT NOT NULL,
    "blocked_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");
CREATE INDEX "reports_subject_type_subject_id_idx" ON "reports"("subject_type", "subject_id");
CREATE INDEX "reports_reporter_user_id_idx" ON "reports"("reporter_user_id");
CREATE UNIQUE INDEX "user_blocks_blocker_user_id_blocked_user_id_key" ON "user_blocks"("blocker_user_id", "blocked_user_id");
CREATE INDEX "user_blocks_blocked_user_id_idx" ON "user_blocks"("blocked_user_id");
